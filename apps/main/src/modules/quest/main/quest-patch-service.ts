import { Result } from 'better-result';

import { loadApkSigningKey } from '@/lib/android/apk-signing';
import { createProblem, type Problem } from '@/lib/errors';
import { removeQuietly } from '@/lib/filesystem/path';
import { translate } from '@/lib/messages';
import type { OperationProgress, OperationSnapshot } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { beatSaberPackageId, questInstallId } from '@/modules/quest/contract';
import { readApkVersion, rewriteApk } from '@/modules/quest/main/quest-apk-patch';
import type { QuestConnection, QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestDowngrade, type QuestDowngrade } from '@/modules/quest/main/quest-downgrade';
import type { QuestModService } from '@/modules/quest/main/quest-mod-service';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import {
   archiveRuntimeMods,
   backUpDowngradedAssets,
   backUpOriginal,
   preparePlayerData,
   readBackupState,
   readPlayerBackup,
   readRuntimeBackup,
   recoveryError,
   restorePlayerFiles,
   restoreRuntimeMods,
   writeBackupFile
} from '@/modules/quest/main/quest-patch-backup';
import { createQuestPatchResources, type QuestPatchResources } from '@/modules/quest/main/quest-patch-resources';
import {
   questBackup,
   questDataKeeperPlayerDataPath,
   questEarlyModsDir,
   questLateModsDir,
   questLibsDir,
   questPackagesDir,
   questScotland2Path
} from '@/modules/quest/main/quest-paths';
import { archiveSavedPlayerData } from '@/modules/quest/main/quest-player-data';
import { createQuestVersionCatalog, type QuestVersionCatalog } from '@/modules/quest/main/quest-version-catalog';
import type { TargetId } from '@/modules/targets/contract';

import { chmod, copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scopedStorageSdk = 30;

type PatchStep =
   | 'preparing'
   | 'pulling'
   | 'downloading'
   | 'patching'
   | 'signing'
   | 'backing-up'
   | 'downgrading'
   | 'installing'
   | 'restoring'
   | 'modloader'
   | 'core-mods';
const steps: PatchStep[] = [
   'preparing',
   'pulling',
   'downloading',
   'backing-up',
   'downgrading',
   'patching',
   'signing',
   'installing',
   'restoring',
   'modloader',
   'core-mods'
];

export type QuestPatchServiceOptions = {
   devices: QuestDeviceService;
   operations: OperationRegistry;
   dataPath: string;
   appVersion: string;
   resources?: QuestPatchResources;
   stagingRoot?: string;
   installCoreMods: QuestModService['installCoreMods'];
   versionCatalog?: QuestVersionCatalog;
   downgrade?: QuestDowngrade;
   mutations: QuestMutationLock;
};

export type QuestPatchService = ReturnType<typeof createQuestPatchService>;

export function createQuestPatchService(options: QuestPatchServiceOptions) {
   const resources = options.resources ?? createQuestPatchResources({ cacheRoot: join(options.dataPath, 'quest', 'modloader') });
   const signingKeyPath = join(options.dataPath, 'quest', 'signing-key.pem');
   const versionCatalog = options.versionCatalog ?? createQuestVersionCatalog();
   const downgrade = options.downgrade ?? createQuestDowngrade({ cacheRoot: join(options.dataPath, 'quest', 'downgrade') });

   async function patchInstall(request: { targetId: TargetId }): Promise<Result<OperationSnapshot, Problem>> {
      const connection = options.devices.getConnection(request.targetId);
      if (Result.isError(connection)) return Result.err(connection.error);

      const gameVersion = connection.value.gameVersion;
      if (!gameVersion) {
         const backup = await readBackupState(connection.value);
         if (Result.isError(backup)) return Result.err(backup.error);
         if (!backup.value.apk) return Result.err(createProblem('quest.patch.app-missing'));
         if (!backup.value.complete) return Result.err(createProblem('quest.patch.backup-incomplete'));
      }
      const job = options.mutations.acquire(request.targetId);
      if (Result.isError(job)) return Result.err(job.error);

      return Result.ok(
         options.operations.start(
            {
               kind: 'patch',
               title: translate('quest.operations.patch'),
               message: gameVersion
                  ? translate('quest.operations.gameVersion', { version: gameVersion })
                  : translate('quest.operations.reinstalling'),
               targetId: request.targetId,
               progress: progressFor('preparing', translate('quest.operations.patchSteps.preparing')),
               metadata: { installId: questInstallId, gameVersion }
            },
            (operationId, signal) => runPatch(operationId, request.targetId, connection.value, signal),
            job.value
         )
      );
   }

   async function runPatch(operationId: string, targetId: TargetId, connection: QuestConnection, signal: AbortSignal) {
      const staging = await Result.tryPromise({
         try: () => mkdtemp(join(options.stagingRoot ?? tmpdir(), 'encore-patch-')),
         catch: (cause) => createProblem('quest.patch.staging-failed', { cause })
      });
      if (Result.isError(staging)) return options.operations.fail(operationId, staging.error);

      const patched = await patchDevice(operationId, targetId, connection, staging.value, signal);

      await removeQuietly(staging.value);
      await Result.tryPromise(() => options.devices.refresh());

      if (signal.aborted && !patched.committed) return;
      if (Result.isError(patched.result)) options.operations.fail(operationId, patched.result.error);
      else options.operations.complete(operationId, { targetId, installId: questInstallId, ...patched.result.value });
   }

   async function patchDevice(operationId: string, targetId: TargetId, connection: QuestConnection, staging: string, signal: AbortSignal) {
      const { client, serial } = connection;
      type PatchPhase = { status: 'preparing' } | { status: 'committed'; recover: ((failure: Problem) => Promise<Problem>) | null };
      let phase: PatchPhase = { status: 'preparing' };
      const readPhase = (): PatchPhase => phase;
      let discardBackup = false;
      const step = (name: PatchStep, label: string): Result<void, Problem> => {
         if (phase.status === 'preparing' && signal.aborted) return Result.err(createProblem('quest.patch.cancelled'));
         options.operations.update(operationId, { progress: progressFor(name, label) });
         return Result.ok(undefined);
      };
      const commit = (recover: ((failure: Problem) => Promise<Problem>) | null = null): Result<void, Problem> => {
         if (phase.status === 'preparing' && signal.aborted) return Result.err(createProblem('quest.patch.cancelled'));
         phase = { status: 'committed', recover };
         options.operations.update(operationId, { cancelable: false });
         return Result.ok(undefined);
      };

      const pipeline = await Result.tryPromise({
         try: () =>
            Result.gen(async function* () {
               yield* step('preparing', translate('quest.operations.patchSteps.finding'));
               const installedApk = yield* Result.await(client.packageApkPath(serial, beatSaberPackageId));
               const state = yield* Result.await(readBackupState(connection));
               const downgradedInstall = installedApk !== null && state.downgraded && connection.gameVersion === state.downgradeVersion;
               const patchedInstall = installedApk ? yield* Result.await(client.packagePatched(serial, beatSaberPackageId)) : false;
               const reuseBackup = state.complete && state.apk && (!installedApk || patchedInstall || downgradedInstall);
               const sourceApk = reuseBackup && !downgradedInstall ? questBackup.apk : installedApk;
               if (!sourceApk) return Result.err(createProblem('quest.patch.app-missing'));
               const originalApk = join(staging, 'original.apk');
               const localApk = join(staging, 'base.apk');

               yield* step('pulling', translate('quest.operations.patchSteps.pulling'));
               yield* Result.await(client.pull(serial, sourceApk, originalApk));
               const version = yield* Result.await(readApkVersion(originalApk));
               if (!version) return Result.err(createProblem('quest.patch.version-missing'));
               options.operations.update(operationId, {
                  message: translate('quest.operations.gameVersion', { version }),
                  metadata: { installId: questInstallId, gameVersion: version }
               });
               const sdk = yield* Result.await(client.sdkVersion(serial));
               if (sdk === null) return Result.err(createProblem('quest.patch.sdk-unknown'));
               const legacyDevice = sdk < scopedStorageSdk;

               const key = yield* Result.await(loadApkSigningKey(signingKeyPath));
               if (installedApk) yield* Result.await(client.forceStop(serial, beatSaberPackageId));

               yield* step('downloading', translate('quest.operations.patchSteps.downloading'));
               const plan = yield* Result.await(versionCatalog.plan(version));
               const libMain = yield* Result.await(resources.libMainLoader(signal));
               const scotland2 = yield* Result.await(resources.scotland2(signal));
               const libUnity = yield* Result.await(resources.unstrippedUnity(plan.version, signal));
               const libOvrPlatformLoader = legacyDevice ? yield* Result.await(resources.legacyOvrPlatformLoader(signal)) : null;

               yield* step('backing-up', translate('quest.operations.patchSteps.backingUp'));
               let runtimeBackup = yield* Result.await(readRuntimeBackup(connection));
               const originalBackup = yield* Result.await(
                  reuseBackup ? readPlayerBackup(connection, version, downgradedInstall) : backUpOriginal(connection, sourceApk, version, staging)
               );
               discardBackup = originalBackup.disposable;
               if (runtimeBackup?.version === version) yield* Result.await(restoreRuntimeMods(connection, runtimeBackup));
               const playerData = yield* Result.await(preparePlayerData(connection, staging, originalBackup, installedApk !== null && reuseBackup));
               let backup = originalBackup;
               let didRemoveDlc = false;
               if (plan.downgrade) {
                  const prepared = yield* Result.await(downgrade.prepare({ ...connection, gameVersion: version }, plan, signal));
                  yield* Result.await(writeBackupFile(connection, staging, questBackup.downgradeVersion, plan.version));
                  yield* step('downgrading', translate('quest.operations.patchSteps.downgrading', { version: plan.version }));
                  const originalAssets = { ...originalBackup, obbDirectory: questBackup.obbDir };
                  yield* commit((failure) =>
                     recoveryError(connection, { apk: originalApk, version, backup: originalAssets, runtime: runtimeBackup, playerData }, failure)
                  );
                  if (sourceApk === questBackup.apk) {
                     if (installedApk) yield* Result.await(client.uninstallPackage(serial, beatSaberPackageId));
                     yield* Result.await(client.installApk(serial, originalApk));
                     yield* Result.await(restorePlayerFiles(connection, originalAssets, playerData, questDataKeeperPlayerDataPath));
                  }
                  didRemoveDlc = (yield* Result.await(prepared.run())).didRemoveDlc;
                  backup = yield* Result.await(backUpDowngradedAssets(connection, originalBackup));
                  runtimeBackup = yield* Result.await(archiveRuntimeMods(connection, staging, version));
                  const downgradedApk = yield* Result.await(client.packageApkPath(serial, beatSaberPackageId));
                  if (!downgradedApk) return Result.err(createProblem('quest.patch.downgraded-app-missing'));
                  yield* Result.await(client.pull(serial, downgradedApk, localApk));
                  options.operations.update(operationId, {
                     message: translate('quest.operations.gameVersion', { version: plan.version }),
                     metadata: { installId: questInstallId, gameVersion: plan.version, dlcRequiresRedownload: didRemoveDlc }
                  });
               }

               yield* step('patching', translate('quest.operations.patchSteps.patching'));
               yield* Result.await(
                  Result.tryPromise({
                     try: async () => {
                        if (!plan.downgrade) await copyFile(originalApk, localApk);
                        await chmod(localApk, 0o600);
                     },
                     catch: (cause) => createProblem('quest.patch.copy-failed', { cause })
                  })
               );
               yield* Result.await(
                  rewriteApk(localApk, {
                     libMain,
                     libUnity,
                     libOvrPlatformLoader,
                     legacyDevice,
                     appVersion: options.appVersion,
                     key,
                     onSign: () => step('signing', translate('quest.operations.patchSteps.signing'))
                  })
               );

               yield* step('installing', translate('quest.operations.patchSteps.installing'));
               yield* commit((failure) =>
                  recoveryError(connection, { apk: originalApk, version, backup: originalBackup, runtime: runtimeBackup, playerData }, failure)
               );
               if (installedApk || plan.downgrade) yield* Result.await(client.uninstallPackage(serial, beatSaberPackageId));
               yield* Result.await(client.installApk(serial, localApk));

               yield* step('restoring', translate('quest.operations.patchSteps.restoring'));
               yield* Result.await(restorePlayerFiles(connection, backup, playerData, questDataKeeperPlayerDataPath));
               yield* Result.await(grantStoragePermissions(connection, sdk));

               yield* step('modloader', translate('quest.operations.patchSteps.modloader'));
               for (const directory of [questEarlyModsDir, questLateModsDir, questLibsDir, questPackagesDir]) {
                  yield* Result.await(client.mkdirs(serial, directory));
               }
               yield* Result.await(client.push(serial, scotland2, questScotland2Path));
               phase = { status: 'committed', recover: null };
               yield* Result.await(archiveSavedPlayerData(connection));
               yield* step('core-mods', translate('quest.operations.patchSteps.coreMods'));
               yield* Result.await(
                  options.installCoreMods({ targetId, installId: questInstallId, operationId, signal: new AbortController().signal })
               );
               yield* Result.await(client.removePath(serial, questBackup.dir));
               return Result.ok({ gameVersion: plan.version, didRemoveDlc });
            }),
         catch: (cause) => createProblem('quest.patch.failed', { cause })
      }).then(Result.flatten);
      const finalPhase = readPhase();
      const committed = finalPhase.status === 'committed';
      if (Result.isOk(pipeline)) return { committed, result: pipeline };
      if (finalPhase.status === 'committed' && finalPhase.recover) {
         options.operations.update(operationId, { progress: progressFor('restoring', translate('quest.operations.patchSteps.recovering')) });
         return { committed: true, result: Result.err(await finalPhase.recover(pipeline.error)) };
      }
      if (!committed && discardBackup) await client.removePath(serial, questBackup.dir);
      return { committed, result: pipeline };
   }

   return { patchInstall };
}

function grantStoragePermissions(connection: QuestConnection, sdk: number) {
   const { client, serial } = connection;

   return Result.gen(async function* () {
      if (sdk >= scopedStorageSdk) {
         yield* Result.await(client.shell(serial, `appops set --uid ${beatSaberPackageId} MANAGE_EXTERNAL_STORAGE allow`));
      } else {
         for (const permission of ['WRITE_EXTERNAL_STORAGE', 'READ_EXTERNAL_STORAGE']) {
            yield* Result.await(client.shell(serial, `pm grant ${beatSaberPackageId} android.permission.${permission}`));
         }
      }
      return Result.ok(undefined);
   });
}

function progressFor(phase: PatchStep, label: string): OperationProgress {
   const current = steps.indexOf(phase);

   return { phase, label, current, total: steps.length, percent: Math.round((current / steps.length) * 100), unit: 'steps' };
}
