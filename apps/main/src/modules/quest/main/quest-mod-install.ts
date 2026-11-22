import { Result } from 'better-result';
import semver from 'semver';

import { downloadContent, type DownloadedContent } from '@/lib/content/content-download';
import { verifyFileHash } from '@/lib/content/content-hash';
import type { ContentHash, ContentProblem } from '@/lib/content/contract';
import { createProblem, type Problem } from '@/lib/errors';
import { removeQuietly } from '@/lib/filesystem/path';
import { downloadHostsFor, resolveHttpsUrl } from '@/lib/http/url';
import { translate } from '@/lib/messages';
import { percentOf } from '@/lib/progress';
import type { ReadyModUninstallPreview } from '@/modules/mods/contract';
import type { ModIndex, ModIndexEntry } from '@/modules/mods/main/mod-index';
import { modContentLimits } from '@/modules/mods/main/mod-install';
import { progressFor } from '@/modules/mods/main/mod-plan';
import type { ModRepositoryService } from '@/modules/mods/main/repo-service';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { beatSaberPackageId, questInstallId } from '@/modules/quest/contract';
import { openQmod, type OpenedQmod, type QmodManifest } from '@/modules/quest/main/qmod';
import type { QuestConnection } from '@/modules/quest/main/quest-device-service';
import { qmodFileTargets, requiredQuestDependencies, saveRecords, type QuestRecord } from '@/modules/quest/main/quest-mod-records';
import {
   isQuestModFile,
   isQuestPackagePath,
   questEarlyModsDir,
   questLateModsDir,
   questLibsDir,
   questPackagePath,
   questPackagesDir,
   questStagingDir,
   sanitizeQuestFileName
} from '@/modules/quest/main/quest-paths';
import type { TargetId } from '@/modules/targets/contract';

import { randomUUID } from 'node:crypto';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, posix } from 'node:path';

const maxQueuedQmods = 256;

export type QuestContext = {
   targetId: TargetId;
   connection: QuestConnection;
   gameVersion: string;
   index: ModIndex;
};

export type QuestDownload = (input: {
   url: string;
   destinationPath: string;
   host: string;
   signal: AbortSignal;
   onProgress: (percent: number) => void;
}) => Promise<Result<Pick<DownloadedContent, 'bytes'>, ContentProblem>>;

export type QuestModJob = {
   context: QuestContext;
   operations: OperationRegistry;
   operationId: string;
   staging: string;
   signal: AbortSignal;
   download: QuestDownload;
   repositories: Pick<ModRepositoryService, 'checkDownloadHost'>;
};

export type QueuedQmod = {
   id: string;
   name: string;
   url: string | null;
   host: string | null;
   localPath: string | null;
   expectedHash: ContentHash | null;
   expectedVersion: string | null;
   modId: string | null;
};

type PreparedQmod = { item: QueuedQmod; manifest: QmodManifest; path: string; bytes: number };

export function toQueuedQmod(entry: ModIndexEntry): QueuedQmod {
   return {
      id: entry.packageId,
      name: entry.name,
      url: entry.downloadUrl,
      host: entry.downloadHost,
      localPath: null,
      expectedHash: entry.archiveHash,
      expectedVersion: entry.version,
      modId: entry.modId
   };
}

export function localQmod(path: string, name: string): QueuedQmod {
   return { id: name, name, url: null, host: null, localPath: path, expectedHash: null, expectedVersion: null, modId: null };
}

export async function withStaging<Value>(
   stagingRoot: string | undefined,
   run: (staging: string) => Promise<Result<Value, Problem>>
): Promise<Result<Value, Problem>> {
   const staging = await Result.tryPromise({
      try: () => mkdtemp(join(stagingRoot ?? tmpdir(), 'encore-quest-')),
      catch: (cause) => createProblem('quest.install.staging-failed', { cause })
   });
   if (Result.isError(staging)) return Result.err(staging.error);

   try {
      return await run(staging.value);
   } finally {
      await removeQuietly(staging.value);
   }
}

export function prepareInstall(job: QuestModJob, queue: QueuedQmod[], records: QuestRecord[]) {
   return Result.gen(async function* () {
      const prepared: PreparedQmod[] = [];
      for (const [index, item] of queue.entries()) {
         if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
         if (queue.findLast((candidate) => candidate.id === item.id) !== item) continue;
         job.operations.update(job.operationId, { progress: progressFor(index, queue.length, item.name, 0) });
         const fetched = yield* Result.await(
            fetchQmod(job, item, (percent) => {
               job.operations.update(job.operationId, { progress: progressFor(index, queue.length, item.name, percent) });
            })
         );
         const opened = yield* Result.await(openQmod(fetched.path));
         const manifest = opened.manifest;
         opened.close();
         yield* validateQmod(job.context.gameVersion, item, manifest);
         item.id = manifest.id;
         prepared.push({ item, manifest, path: fetched.path, bytes: fetched.bytes });
         yield* enqueueDependencies(queue, job.context.index, manifest, records, prepared);
      }

      const selected = prepared.filter((entry) => queue.findLast((item) => item.id === entry.manifest.id) === entry.item);
      for (const { manifest } of selected) {
         for (const dependency of manifest.dependencies) {
            const queued = selected.find((entry) => entry.manifest.id === dependency.id);
            const installed = records.find((record) => record.id === dependency.id);
            const version = queued?.manifest.version ?? installed?.version;
            if (version && dependencySatisfied(version, dependency.version)) continue;
            if (!version && !dependency.required) continue;
            return Result.err(missingDependency(manifest, dependency));
         }
      }
      return Result.ok(selected);
   });
}

export function writeInstall(job: QuestModJob, prepared: PreparedQmod[], installedRecords: QuestRecord[]) {
   const { client, serial } = job.context.connection;
   const records = [...installedRecords];

   return Result.gen(async function* () {
      if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
      let files = 0;
      let bytes = 0;

      for (const dir of [questEarlyModsDir, questLateModsDir, questLibsDir, questPackagesDir]) yield* Result.await(client.mkdirs(serial, dir));
      yield* Result.await(client.forceStop(serial, beatSaberPackageId));

      for (const [index, entry] of prepared.entries()) {
         if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
         job.operations.update(job.operationId, { progress: progressFor(index, prepared.length, entry.manifest.name, 0) });
         const opened = yield* Result.await(openQmod(entry.path));
         const pushed = await pushQmod(job, opened, entry.path).finally(opened.close);
         const record = { ...(yield* pushed), modId: entry.item.modId };

         const previous = records.find((candidate) => candidate.id === record.id);
         if (previous) {
            for (const stale of previous.files.filter((file) => !record.files.includes(file) && isQuestModFile(file))) {
               if (records.some((candidate) => candidate.id !== record.id && candidate.files.includes(stale))) continue;
               yield* Result.await(client.removeFile(serial, stale));
            }
            if (previous.packagePath !== record.packagePath && isQuestPackagePath(previous.packagePath)) {
               yield* Result.await(client.removePath(serial, previous.packagePath));
            }
         }

         records.splice(0, records.length, ...records.filter((candidate) => candidate.id !== record.id), record);
         yield* Result.await(saveRecords(job.context.connection, records, job.staging));

         files += record.files.length + 1;
         bytes += entry.bytes;
      }

      if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
      return Result.ok({ installId: questInstallId, mods: prepared.length, files, bytes });
   });
}

export function writeUninstall(job: QuestModJob, previewed: ReadyModUninstallPreview, removed: QuestRecord[], remaining: QuestRecord[]) {
   const { client, serial } = job.context.connection;
   const recordFiles = new Set(removed.flatMap((record) => record.files));
   const retainedFiles = new Set(remaining.flatMap((record) => record.files));
   const removable = (path: string) => previewed.folders.includes(path) || (recordFiles.has(path) ? isQuestModFile(path) : isQuestPackagePath(path));
   const paths = [
      ...previewed.mods.flatMap((removal) => removal.files),
      ...previewed.external.map((external) => external.path),
      ...previewed.folders
   ].filter((path) => !retainedFiles.has(path) && removable(path));

   return Result.gen(async function* () {
      yield* Result.await(client.forceStop(serial, beatSaberPackageId));
      if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
      for (const [index, path] of paths.entries()) {
         yield* Result.await(recordFiles.has(path) ? client.removeFile(serial, path) : client.removePath(serial, path));
         job.operations.update(job.operationId, {
            progress: { phase: 'deleting', current: index + 1, total: paths.length, percent: percentOf(index + 1, paths.length), unit: 'files' }
         });
      }

      for (const folder of previewed.folders) yield* Result.await(client.mkdirs(serial, folder));
      yield* Result.await(saveRecords(job.context.connection, previewed.scope === 'all' ? [] : remaining, job.staging));

      return Result.ok({ installId: questInstallId, mods: previewed.mods.length, files: paths.length });
   });
}

export function validateQmod(gameVersion: string, item: QueuedQmod, manifest: QmodManifest): Result<void, Problem> {
   if ((!item.localPath && item.id !== manifest.id) || (item.expectedVersion && manifest.version !== item.expectedVersion)) {
      return Result.err(createProblem('quest.install.package-mismatch', { name: item.name }));
   }
   const unsafe = qmodFileTargets(manifest).find((target) => !isQuestModFile(target.path));
   if (unsafe) return Result.err(createProblem('quest.install.unsafe-destination', { name: manifest.name, detail: unsafe.path }));
   if (
      manifest.packageId !== beatSaberPackageId ||
      manifest.modloader.toLowerCase() !== 'scotland2' ||
      (!manifest.isLibrary &&
         manifest.packageVersion &&
         manifest.packageVersion !== gameVersion &&
         manifest.packageVersion !== gameVersion.split('_')[0])
   ) {
      return Result.err(createProblem('quest.install.incompatible-qmod', { name: manifest.name }));
   }
   return Result.ok(undefined);
}

async function fetchQmod(
   job: QuestModJob,
   item: QueuedQmod,
   onProgress: (percent: number) => void
): Promise<Result<{ path: string; bytes: number }, Problem>> {
   const localPath = item.localPath;
   if (localPath) {
      const info = await Result.tryPromise(() => stat(localPath));
      return Result.ok({ path: localPath, bytes: Result.isOk(info) ? info.value.size : 0 });
   }

   const { url, host } = item;
   if (!url || !host) return Result.err(createProblem('quest.install.missing-download', { name: item.name }));
   const named = (problem: Problem) => ({ ...problem, message: translate('quest.operations.named', { name: item.name, message: problem.message }) });

   return Result.gen(async function* () {
      yield* Result.await(job.repositories.checkDownloadHost(host).then((result) => result.mapError(named)));
      const destinationPath = join(job.staging, `${sanitizeQuestFileName(item.id)}.qmod`);
      const downloaded = yield* Result.await(
         job.download({ url, destinationPath, host, signal: job.signal, onProgress }).then((result) => result.mapError(named))
      );
      if (item.expectedHash) {
         yield* Result.await(verifyFileHash({ path: destinationPath, expected: item.expectedHash }).then((result) => result.mapError(named)));
      }
      return Result.ok({ path: destinationPath, bytes: downloaded.bytes });
   });
}

function enqueueDependencies(queue: QueuedQmod[], index: ModIndex, manifest: QmodManifest, records: QuestRecord[], prepared: PreparedQmod[]) {
   for (const dependency of manifest.dependencies) {
      const queued = queue.findLast((item) => item.id === dependency.id);
      const queuedVersion = queued ? (prepared.findLast((entry) => entry.item === queued)?.manifest.version ?? queued.expectedVersion) : null;
      if (queued && (!queuedVersion || dependencySatisfied(queuedVersion, dependency.version))) continue;
      const installed = records.find((record) => record.id === dependency.id);
      if (!dependency.required || (installed && dependencySatisfied(installed.version, dependency.version))) continue;
      if (queue.length >= maxQueuedQmods) return Result.err(createProblem('quest.install.too-many-dependencies'));

      const entry = index.entries.find(
         (candidate) => candidate.packageId === dependency.id && dependencySatisfied(candidate.version, dependency.version)
      );
      if (entry) {
         queue.push(toQueuedQmod(entry));
         continue;
      }

      const url = dependency.downloadIfMissing ? resolveHttpsUrl(dependency.downloadIfMissing) : null;
      if (url && Result.isOk(url)) {
         queue.push({
            id: dependency.id,
            name: dependency.id,
            url: url.value.toString(),
            host: url.value.hostname,
            localPath: null,
            expectedHash: null,
            expectedVersion: null,
            modId: null
         });
         continue;
      }
      return Result.err(missingDependency(manifest, dependency));
   }
   return Result.ok(undefined);
}

function missingDependency(manifest: QmodManifest, dependency: QmodManifest['dependencies'][number]) {
   return createProblem('quest.install.dependency-unavailable', { name: manifest.name, dependency: dependency.id, range: dependency.version });
}

export function dependencySatisfied(version: string, range: string) {
   const parsed = semver.valid(version) ?? semver.coerce(version);
   return parsed !== null && semver.satisfies(parsed, range, { includePrerelease: true });
}

async function pushQmod(job: QuestModJob, opened: OpenedQmod, archivePath: string): Promise<Result<QuestRecord, Problem>> {
   const { client, serial } = job.context.connection;
   const manifest = opened.manifest;
   const targets = qmodFileTargets(manifest);
   const packagePath = questPackagePath(manifest.id);
   const remoteStaging = `${questStagingDir}/mod-${randomUUID()}`;
   const stagedPath = (index: number) => `${remoteStaging}/${index}`;
   const live = new Map([...targets.map((target) => target.path), packagePath].map((path, index) => [path, stagedPath(index)]));

   const published = await Result.gen(async function* () {
      yield* Result.await(client.mkdirs(serial, remoteStaging));
      for (const [index, target] of targets.entries()) {
         if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
         const localPath = join(job.staging, `push-${sanitizeQuestFileName(basename(target.name))}`);
         yield* Result.await(opened.extract(target.name, localPath));
         const pushed = await client.push(serial, localPath, stagedPath(index));
         await removeQuietly(localPath);
         yield* pushed;
      }
      if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));
      yield* Result.await(client.push(serial, archivePath, stagedPath(targets.length)));
      if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));

      for (const path of live.keys()) yield* Result.await(client.removeFile(serial, path));
      for (const directory of new Set([...live.keys()].map((path) => posix.dirname(path)))) yield* Result.await(client.mkdirs(serial, directory));
      for (const [path, staged] of live) yield* Result.await(client.movePath(serial, staged, path));

      return Result.ok<QuestRecord, Problem>({
         id: manifest.id,
         name: manifest.name,
         version: manifest.version,
         modId: null,
         requiredDependencies: requiredQuestDependencies(manifest),
         files: targets.map((target) => target.path),
         packagePath
      });
   });
   await client.removePath(serial, remoteStaging);
   return published;
}

export const defaultQuestDownload: QuestDownload = (input) =>
   downloadContent({
      url: input.url,
      destinationPath: input.destinationPath,
      limits: modContentLimits,
      policy: { allowedHosts: downloadHostsFor(input.host) },
      signal: input.signal,
      onProgress: (progress) => input.onProgress(progress.percent ?? 0)
   });
