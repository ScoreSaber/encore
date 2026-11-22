import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import type { ProblemCode } from '@/lib/messages';
import { beatSaberPackageId } from '@/modules/quest/contract';
import type { QuestConnection } from '@/modules/quest/main/quest-device-service';
import {
   questAuxiliaryPlayerDataPath,
   questBackup,
   questDataKeeperPlayerDataPath,
   questEarlyModsDir,
   questLateModsDir,
   questLibsDir,
   questObbDir,
   questPlayerDataPath,
   questRecordsPath,
   questRuntimeModsDir,
   questSavedPlayerDataPath
} from '@/modules/quest/main/quest-paths';
import { foldPlayerData, publishPlayerData } from '@/modules/quest/main/quest-player-data';

import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

type PlayerBackup = { obbs: boolean; playerData: boolean; obbDirectory: string };

const nextBackupDir = `${questBackup.dir}-next`;
const oldBackupDir = `${questBackup.dir}-old`;

const runtimeBackupSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:_\d+)?$/), archiveId: z.uuid() });
type RuntimeBackup = z.infer<typeof runtimeBackupSchema>;

const runtimeDirectories = [questEarlyModsDir, questLateModsDir, questLibsDir];

export function readBackupState({ client, serial }: Pick<QuestConnection, 'client' | 'serial'>) {
   const readVersion = (path: string) =>
      Result.gen(async function* () {
         if (!(yield* Result.await(client.fileExists(serial, path)))) return Result.ok(null);
         return Result.ok((yield* Result.await(client.readTextFile(serial, path))).trim());
      });

   return Result.gen(async function* () {
      const hasBackupDir = yield* Result.await(client.fileExists(serial, questBackup.dir));
      if (!hasBackupDir && (yield* Result.await(client.fileExists(serial, oldBackupDir)))) {
         yield* Result.await(client.movePath(serial, oldBackupDir, questBackup.dir));
      }
      const complete = yield* Result.await(client.fileExists(serial, questBackup.done));
      const apk = yield* Result.await(client.fileExists(serial, questBackup.apk));
      if (!complete) return Result.ok({ complete, apk, version: null, downgraded: false, downgradeVersion: null });

      const version = yield* Result.await(readVersion(questBackup.version));
      const downgraded = yield* Result.await(client.fileExists(serial, questBackup.downgradedDone));
      const downgradeVersion = downgraded ? yield* Result.await(readVersion(questBackup.downgradeVersion)) : null;
      return Result.ok({ complete, apk, version, downgraded, downgradeVersion });
   });
}

export function backUpOriginal(connection: QuestConnection, sourceApk: string, version: string, staging: string) {
   const { client, serial } = connection;

   return Result.gen(async function* () {
      const stranded =
         !(yield* Result.await(client.fileExists(serial, questBackup.dir))) && (yield* Result.await(client.fileExists(serial, oldBackupDir)));
      if (stranded) yield* Result.await(client.movePath(serial, oldBackupDir, questBackup.dir));
      const existing = yield* Result.await(readBackupState(connection));
      const carried = existing.complete && (yield* Result.await(client.fileExists(serial, questBackup.playerData)));
      const playerData = yield* Result.await(
         foldPlayerData(connection, staging, [...(carried ? [questBackup.playerData] : []), questPlayerDataPath])
      );

      const next = (path: string) => `${nextBackupDir}/${posix.basename(path)}`;
      yield* Result.await(client.removePath(serial, nextBackupDir));
      yield* Result.await(client.mkdirs(serial, nextBackupDir));
      yield* Result.await(copyOrFail(connection, sourceApk, next(questBackup.apk), 'quest.patch.backup-apk-failed'));
      const obbs = yield* Result.await(client.fileExists(serial, questObbDir));
      if (obbs) yield* Result.await(copyOrFail(connection, questObbDir, next(questBackup.obbDir), 'quest.patch.backup-obb-failed'));
      if (playerData) yield* Result.await(client.push(serial, playerData, next(questBackup.playerData)));
      yield* Result.await(writeBackupFile(connection, staging, next(questBackup.version), version));
      yield* Result.await(client.mkdirs(serial, next(questBackup.done)));

      if (yield* Result.await(client.fileExists(serial, questBackup.dir))) {
         yield* Result.await(client.removePath(serial, oldBackupDir));
         yield* Result.await(client.movePath(serial, questBackup.dir, oldBackupDir));
      }
      const swapped = await client.movePath(serial, nextBackupDir, questBackup.dir);
      if (Result.isError(swapped)) {
         await client.movePath(serial, oldBackupDir, questBackup.dir);
         return swapped;
      }
      await client.removePath(serial, oldBackupDir);
      return Result.ok({ obbs, playerData: playerData !== null, obbDirectory: questBackup.obbDir, disposable: !carried });
   });
}

export function readPlayerBackup(connection: QuestConnection, version: string, downgraded: boolean) {
   const { client, serial } = connection;

   return Result.gen(async function* () {
      const existing = yield* Result.await(readBackupState(connection));
      if (!existing.complete || !existing.apk) return Result.err(createProblem('quest.patch.backup-incomplete'));
      const backedUpVersion = downgraded ? existing.downgradeVersion : existing.version;
      if (backedUpVersion !== null && backedUpVersion !== version) return Result.err(createProblem('quest.patch.backup-version-mismatch'));
      const obbDirectory = downgraded ? questBackup.downgradedObbDir : questBackup.obbDir;
      const obbs = yield* Result.await(client.fileExists(serial, obbDirectory));
      const playerData = yield* Result.await(client.fileExists(serial, questBackup.playerData));
      return Result.ok({ obbs, playerData, obbDirectory, disposable: false });
   });
}

export function backUpDowngradedAssets<Backup extends PlayerBackup>(connection: QuestConnection, original: Backup) {
   const { client, serial } = connection;

   return Result.gen(async function* () {
      yield* Result.await(client.removePath(serial, questBackup.downgradedDone));
      yield* Result.await(client.removePath(serial, questBackup.downgradedObbDir));
      const obbs = yield* Result.await(client.fileExists(serial, questObbDir));
      if (obbs) yield* Result.await(copyOrFail(connection, questObbDir, questBackup.downgradedObbDir, 'quest.patch.backup-downgraded-failed'));
      yield* Result.await(client.mkdirs(serial, questBackup.downgradedDone));
      return Result.ok({ ...original, obbs, obbDirectory: questBackup.downgradedObbDir });
   });
}

export function writeBackupFile(connection: QuestConnection, staging: string, remotePath: string, contents: string) {
   return Result.gen(async function* () {
      const localPath = join(staging, posix.basename(remotePath));
      yield* Result.await(
         Result.tryPromise({
            try: () => writeFile(localPath, contents),
            catch: (cause) => createProblem('quest.patch.backup-failed', { cause })
         })
      );
      return connection.client.push(connection.serial, localPath, remotePath);
   });
}

export function preparePlayerData(connection: QuestConnection, staging: string, backup: PlayerBackup, unsavedLive: boolean) {
   const { client, serial } = connection;
   const sources = [
      questDataKeeperPlayerDataPath,
      questSavedPlayerDataPath,
      ...(backup.playerData ? [questBackup.playerData] : []),
      ...(unsavedLive ? [questPlayerDataPath] : [])
   ];

   return Result.gen(async function* () {
      const merged = await foldPlayerData(connection, staging, sources);
      if (Result.isOk(merged) || unsavedLive || merged.error.code !== 'quest.player-data.unreadable') return merged;
      if (!backup.playerData || (yield* Result.await(client.fileExists(serial, questDataKeeperPlayerDataPath)))) return Result.ok(null);
      const raw = join(staging, 'PlayerData.backup.dat');
      yield* Result.await(client.pull(serial, questBackup.playerData, raw));
      return Result.ok(raw);
   });
}

export function restorePlayerFiles(connection: QuestConnection, backup: PlayerBackup, playerData: string | null, destination: string) {
   const { client, serial } = connection;

   return Result.gen(async function* () {
      if (backup.obbs) {
         yield* Result.await(client.mkdirs(serial, questObbDir));
         yield* Result.await(copyOrFail(connection, `${backup.obbDirectory}/.`, questObbDir, 'quest.patch.restore-obb-failed'));
      }
      if (backup.playerData) {
         yield* Result.await(client.mkdirs(serial, posix.dirname(questAuxiliaryPlayerDataPath)));
         yield* Result.await(copyOrFail(connection, questBackup.playerData, questAuxiliaryPlayerDataPath, 'quest.patch.backup-player-data-failed'));
      }
      if (!playerData) return Result.ok(undefined);
      return publishPlayerData(connection, playerData, destination);
   });
}

export function archiveRuntimeMods(connection: QuestConnection, staging: string, version: string) {
   const { client, serial } = connection;
   const backup = { version, archiveId: randomUUID() };
   const root = questRuntimeModsDir(backup.version, backup.archiveId);

   return Result.gen(async function* () {
      let copied = false;
      for (const directory of runtimeDirectories) {
         if (!(yield* Result.await(client.fileExists(serial, directory)))) continue;
         const destination = `${root}/${posix.basename(directory)}`;
         yield* Result.await(client.mkdirs(serial, destination));
         yield* Result.await(copyOrFail(connection, `${directory}/.`, destination, 'quest.patch.runtime-save-failed'));
         copied = true;
      }
      if (yield* Result.await(client.fileExists(serial, questRecordsPath))) {
         yield* Result.await(
            copyOrFail(connection, questRecordsPath, `${root}/${posix.basename(questRecordsPath)}`, 'quest.patch.runtime-save-failed')
         );
         copied = true;
      }
      if (copied) yield* Result.await(writeBackupFile(connection, staging, questBackup.runtime, JSON.stringify(backup)));
      for (const directory of runtimeDirectories) yield* Result.await(client.removePath(serial, directory));
      return Result.ok(copied ? backup : null);
   });
}

export function readRuntimeBackup({ client, serial }: QuestConnection) {
   return Result.gen(async function* () {
      if (!(yield* Result.await(client.fileExists(serial, questBackup.runtime)))) return Result.ok(null);
      const text = yield* Result.await(client.readTextFile(serial, questBackup.runtime));
      return Result.try({
         try: () => runtimeBackupSchema.parse(JSON.parse(text)),
         catch: (cause) => createProblem('quest.patch.backup-invalid', { cause })
      });
   });
}

export function restoreRuntimeMods(connection: QuestConnection, backup: RuntimeBackup) {
   const { client, serial } = connection;
   const root = questRuntimeModsDir(backup.version, backup.archiveId);

   return Result.gen(async function* () {
      for (const directory of runtimeDirectories) {
         const source = `${root}/${posix.basename(directory)}`;
         if (!(yield* Result.await(client.fileExists(serial, source)))) continue;
         yield* Result.await(client.removePath(serial, directory));
         yield* Result.await(client.mkdirs(serial, directory));
         yield* Result.await(copyOrFail(connection, `${source}/.`, directory, 'quest.patch.runtime-restore-failed'));
      }
      const records = `${root}/${posix.basename(questRecordsPath)}`;
      if (yield* Result.await(client.fileExists(serial, records))) {
         yield* Result.await(copyOrFail(connection, records, questRecordsPath, 'quest.patch.runtime-restore-failed'));
      }
      return Result.ok(undefined);
   });
}

export async function recoveryError(
   connection: QuestConnection,
   original: { apk: string; version: string; backup: PlayerBackup; runtime: RuntimeBackup | null; playerData: string | null },
   failure: Problem
): Promise<Problem> {
   const { client, serial } = connection;
   const recovered = await Result.gen(async function* () {
      const installed = yield* Result.await(client.packageApkPath(serial, beatSaberPackageId));
      const version = installed ? yield* Result.await(client.packageVersionName(serial, beatSaberPackageId)) : null;
      const patched = installed ? yield* Result.await(client.packagePatched(serial, beatSaberPackageId)) : false;
      const originalInstalled = installed && version === original.version && !patched;
      if (installed && !originalInstalled) yield* Result.await(client.uninstallPackage(serial, beatSaberPackageId));
      if (!originalInstalled) yield* Result.await(client.installApk(serial, original.apk));
      yield* Result.await(restorePlayerFiles(connection, original.backup, original.playerData, questSavedPlayerDataPath));
      if (original.runtime?.version === original.version) yield* Result.await(restoreRuntimeMods(connection, original.runtime));
      if (original.backup.obbDirectory === questBackup.obbDir) yield* Result.await(client.removePath(serial, questBackup.downgradedDone));
      return Result.ok(undefined);
   });

   const fields = {
      detail: failure.detail ?? failure.message,
      failure: failure.code,
      backupPath: questBackup.dir,
      recovery: Result.isOk(recovered) ? 'restored' : recovered.error.message
   };
   return createProblem(Result.isOk(recovered) ? 'quest.patch.recovered' : 'quest.patch.not-recovered', fields);
}

function copyOrFail({ client, serial }: QuestConnection, from: string, to: string, code: ProblemCode) {
   return Result.gen(async function* () {
      yield* Result.await(client.copyPath(serial, from, to));
      if (!(yield* Result.await(client.fileExists(serial, to)))) return Result.err(createProblem(code));
      return Result.ok(undefined);
   });
}
