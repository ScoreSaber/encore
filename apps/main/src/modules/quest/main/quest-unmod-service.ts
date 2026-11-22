import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import type { OperationSnapshot } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { beatSaberPackageId, questInstallId } from '@/modules/quest/contract';
import type { QuestConnection, QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { withStaging } from '@/modules/quest/main/quest-mod-install';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import {
   questBackup,
   questDataKeeperPlayerDataPath,
   questPlayerDataBeforeMergePath,
   questPlayerDataMergingPath,
   questPlayerDataPath,
   questSavedPlayerDataPath
} from '@/modules/quest/main/quest-paths';
import { archiveSavedPlayerData, foldPlayerData, publishPlayerData, verifyCopy } from '@/modules/quest/main/quest-player-data';
import type { TargetId } from '@/modules/targets/contract';

type Step = { current: number; total: number; label: string };

type MergeState = { status: 'idle'; failures: number } | { status: 'probing'; failures: number } | { status: 'merging'; failures: number };

export function createQuestUnmodService(options: {
   devices: QuestDeviceService;
   operations: OperationRegistry;
   mutations: QuestMutationLock;
   stagingRoot?: string;
   onUnmodded?: (targetId: TargetId) => void;
}) {
   const mergeStates = new Map<TargetId, MergeState>();
   let disposed = false;
   const isDisposed = () => disposed;
   const unsubscribeDevices = options.devices.subscribe((event) => {
      if (!isDisposed() && event.type === 'target-updated') void mergeWhenReady(event.target.id);
   });

   function mergeStateFor(targetId: TargetId): MergeState {
      return mergeStates.get(targetId) ?? { status: 'idle', failures: 0 };
   }

   async function mergeWhenReady(targetId: TargetId) {
      if (isDisposed()) return;
      const current = mergeStateFor(targetId);
      if (current.status !== 'idle' || current.failures > 1 || !options.devices.getState(targetId).savedPlayerData) return;
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection) || !connection.value.gameVersion || connection.value.modloaderInstalled) return;
      const { client, serial } = connection.value;
      mergeStates.set(targetId, { status: 'probing', failures: current.failures });
      const [created, running] = await Promise.all([
         client.fileExists(serial, questPlayerDataPath),
         client.packageRunning(serial, beatSaberPackageId)
      ]);
      if (isDisposed()) return;
      const latest = mergeStateFor(targetId);
      if (latest.status !== 'probing') return;
      const ready = Result.isOk(created) && created.value && Result.isOk(running) && !running.value;
      if (!ready) {
         mergeStates.set(targetId, { status: 'idle', failures: latest.failures });
         return;
      }
      mergeStates.set(targetId, { status: 'merging', failures: latest.failures });
      if (Result.isError(restorePlayerData(targetId))) {
         mergeStates.set(targetId, { status: 'idle', failures: latest.failures });
      }
   }

   function unmod({ targetId }: { targetId: TargetId }): Result<OperationSnapshot, Problem> {
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) return Result.err(connection.error);
      if (!connection.value.gameVersion || !connection.value.modloaderInstalled) return Result.err(createProblem('quest.unmod.not-modded'));

      mergeStates.set(targetId, { status: 'idle', failures: 0 });
      return startJob(targetId, connection.value, 'delete', translate('quest.unmod.title'), runUnmod);
   }

   function restorePlayerData(targetId: TargetId): Result<OperationSnapshot, Problem> {
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) return Result.err(connection.error);
      if (!connection.value.gameVersion || connection.value.modloaderInstalled) return Result.err(createProblem('quest.player-data.not-vanilla'));

      return startJob(targetId, connection.value, 'copy', translate('quest.operations.restorePlayerData'), runRestore);
   }

   function startJob(
      targetId: TargetId,
      connection: QuestConnection,
      kind: 'copy' | 'delete',
      title: string,
      run: (connection: QuestConnection, staging: string, step: (step: Step) => void) => Promise<Result<void, Problem>>
   ) {
      const lock = options.mutations.acquire(targetId);
      if (Result.isError(lock)) return Result.err(lock.error);

      const operation = options.operations.start(
         {
            kind,
            title,
            message: translate('quest.operations.game'),
            targetId,
            cancelable: false,
            progress: { phase: 'preparing', current: 0, total: 1, percent: 0, unit: 'steps' },
            metadata: { installId: questInstallId }
         },
         async (operationId) => {
            const step = ({ current, total, label }: Step) =>
               options.operations.update(operationId, {
                  progress: { phase: 'running', label, current, total, percent: Math.round((current / total) * 100), unit: 'steps' }
               });
            const done = await withStaging(options.stagingRoot, (staging) => run(connection, staging, step));
            if (kind === 'copy') {
               const state = mergeStateFor(targetId);
               mergeStates.set(targetId, { status: 'idle', failures: Result.isError(done) ? state.failures + 1 : 0 });
            } else {
               options.onUnmodded?.(targetId);
            }
            await Result.tryPromise(() => options.devices.refresh());
            if (Result.isError(done)) options.operations.fail(operationId, done.error);
            else options.operations.complete(operationId, { targetId, installId: questInstallId });
         },
         lock.value
      );
      return Result.ok(operation);
   }

   function runUnmod(connection: QuestConnection, staging: string, step: (step: Step) => void) {
      const { client, serial } = connection;

      return Result.gen(async function* () {
         step({ current: 0, total: 3, label: translate('quest.unmod.preparing') });
         yield* Result.await(client.forceStop(serial, beatSaberPackageId));
         const merged = yield* Result.await(
            foldPlayerData(connection, staging, [
               questBackup.playerData,
               questPlayerDataPath,
               questSavedPlayerDataPath,
               questDataKeeperPlayerDataPath
            ])
         );
         if (merged) yield* Result.await(publishPlayerData(connection, merged, questSavedPlayerDataPath));

         step({ current: 1, total: 3, label: translate('quest.operations.unmodSteps.uninstalling') });
         yield* Result.await(client.uninstallPackage(serial, beatSaberPackageId));

         step({ current: 2, total: 3, label: translate('quest.operations.unmodSteps.clearing') });
         yield* Result.await(client.removePath(serial, questBackup.dir));
         return Result.ok(undefined);
      });
   }

   function runRestore(connection: QuestConnection, staging: string, step: (step: Step) => void) {
      const { client, serial } = connection;

      return Result.gen(async function* () {
         step({ current: 0, total: 3, label: translate('quest.operations.restoreSteps.reading') });
         yield* Result.await(client.forceStop(serial, beatSaberPackageId));
         if (!(yield* Result.await(client.fileExists(serial, questPlayerDataPath)))) {
            return Result.err(createProblem('quest.player-data.not-created'));
         }
         const merged = yield* Result.await(foldPlayerData(connection, staging, [questPlayerDataPath, questSavedPlayerDataPath]));
         if (!merged) return Result.err(createProblem('quest.player-data.missing'));

         step({ current: 1, total: 3, label: translate('quest.operations.restoreSteps.merging') });
         yield* Result.await(client.copyPath(serial, questPlayerDataPath, questPlayerDataBeforeMergePath));
         yield* Result.await(client.push(serial, merged, questPlayerDataMergingPath));
         const owner = yield* Result.await(client.fileOwner(serial, questPlayerDataPath));
         yield* Result.await(client.overwriteFile(serial, questPlayerDataMergingPath, questPlayerDataPath));
         const written = await verifyCopy(connection, merged, questPlayerDataPath);
         const ownerAfter = await client.fileOwner(serial, questPlayerDataPath);
         if (Result.isError(written) || Result.isError(ownerAfter) || ownerAfter.value !== owner) {
            yield* Result.await(client.overwriteFile(serial, questPlayerDataBeforeMergePath, questPlayerDataPath));
            return Result.err(createProblem('quest.player-data.write-failed'));
         }

         step({ current: 2, total: 3, label: translate('quest.operations.restoreSteps.cleaning') });
         yield* Result.await(client.removePath(serial, questPlayerDataMergingPath));
         yield* Result.await(archiveSavedPlayerData(connection));
         return Result.ok(undefined);
      });
   }

   function dispose() {
      disposed = true;
      unsubscribeDevices();
      mergeStates.clear();
   }

   return { unmod, dispose };
}
