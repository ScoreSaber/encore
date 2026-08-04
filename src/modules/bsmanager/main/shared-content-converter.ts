import { Result } from 'better-result';

import { readJsonFile } from '@/lib/filesystem/json';
import { copyPathWithProgress } from '@/lib/filesystem/operations';
import {
   createFilesystemProblem,
   createUniquePath,
   isSamePath,
   resolveFilesystemPath,
   pathExistsSafely,
   type FilesystemProblem
} from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import type { BSManagerVersion, ReadyBSManagerPlan } from '@/modules/bsmanager/contract';
import { bsmanagerAppConfigSchema, writeBSManagerAppConfig } from '@/modules/bsmanager/main/bsmanager-config';
import { bsmanagerAppConfigPath, type BSManagerLocations } from '@/modules/bsmanager/main/bsmanager-paths';
import type { OperationId, OperationSnapshot } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import {
   findSharedFolderDefinition,
   sharedFolderRelativePath,
   type SharedFolderDefinition,
   type SharedLinkMode
} from '@/modules/shared-content/contract';
import { createFolderLink, preferredLinkMode, probeLinkSupport, readFolderLink, removeFolderLink } from '@/modules/shared-content/main/folder-link';
import { backupFolderPath, conflictFolderPath, installFolderPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';

import { mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

type ConverterOptions = {
   operations: OperationRegistry;
   locations: BSManagerLocations;
};

type ConversionGroup = {
   definition: SharedFolderDefinition;
   sourcePath: string;
   destinationPath: string;
   sharedRootPath: string;
   conflictPath: string;
   conflictRootPath: string;
   linkPaths: string[];
   sourceInstallFolderPath: string | null;
};

type ConversionSummary = {
   folders: number;
   bytes: number;
   files: number;
   conflicts: number;
   backups: number;
};

type CopiedGroup = {
   bytes: number;
   files: number;
   conflicts: number;
};

export type BSManagerSharedContentConverter = ReturnType<typeof createBSManagerSharedContentConverter>;

export function createBSManagerSharedContentConverter(options: ConverterOptions) {
   function start(plan: ReadyBSManagerPlan, versions: BSManagerVersion[]) {
      const groups = conversionGroups(plan, versions);
      if (groups.length === 0) return Result.err<OperationSnapshot, 'nothing-to-clean'>('nothing-to-clean');

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'copy',
         title: 'Convert BSManager shared content',
         message: plan.sharedContentPath,
         progress: { phase: 'preparing', current: 0, total: 0, percent: 0, unit: 'bytes' },
         metadata: { rootPath: plan.rootPath, versions: versions.map((version) => version.id) },
         cancel: () => controller.abort()
      });

      void run(operation.id, plan, groups, controller.signal);
      return Result.ok<OperationSnapshot, 'nothing-to-clean'>(operation);
   }

   async function run(operationId: OperationId, plan: ReadyBSManagerPlan, groups: ConversionGroup[], signal: AbortSignal) {
      const support = await probeLinkSupport(plan.sharedContentPath, preferredLinkMode(options.locations.platform, plan.useSymlinks));
      if (!support.supported) {
         return fail(operationId, {
            code: 'filesystem.operation.copy-failed',
            message: 'this filesystem cannot create the links Encore uses',
            path: plan.sharedContentPath,
            ...(support.detail ? { detail: support.detail } : {})
         });
      }

      const appConfigPath = bsmanagerAppConfigPath(options.locations);
      const appConfig = await readJsonFile(appConfigPath, bsmanagerAppConfigSchema, { defaultValue: {} });
      if (Result.isError(appConfig)) return fail(operationId, appConfig.error);

      const appWritten = await writeBSManagerAppConfig(appConfigPath, { ...appConfig.value, 'use-symlinks': support.mode === 'symlink' });
      if (Result.isError(appWritten)) return fail(operationId, appWritten.error);

      const sizes = await Promise.all(groups.map((group) => getDirectorySize(group.sourcePath)));
      let total = 0;
      for (const size of sizes) {
         if (Result.isError(size)) return fail(operationId, size.error);
         total += size.value.bytes;
      }
      let carried = 0;
      const summary: ConversionSummary = { folders: 0, bytes: 0, files: 0, conflicts: 0, backups: 0 };

      options.operations.update(operationId, {
         progress: { phase: 'copying', current: 0, total, percent: 0, unit: 'bytes' }
      });

      for (const group of groups) {
         if (signal.aborted) {
            return fail(operationId, {
               code: 'filesystem.operation.cancelled',
               message: 'shared content conversion was cancelled',
               path: group.sourcePath
            });
         }

         const copied = await copyGroup(operationId, group, carried, total, signal);
         if (Result.isError(copied)) return fail(operationId, copied.error);

         carried += copied.value.bytes;
         summary.bytes += copied.value.bytes;
         summary.files += copied.value.files;
         summary.conflicts += copied.value.conflicts;

         for (const linkPath of group.linkPaths) {
            if (signal.aborted) {
               return fail(operationId, {
                  code: 'filesystem.operation.cancelled',
                  message: 'shared content conversion was cancelled',
                  path: linkPath
               });
            }

            const repointed = await repointLink(linkPath, group.sourcePath, group.destinationPath, support.mode);
            if (Result.isError(repointed)) return fail(operationId, repointed.error);
            summary.folders += 1;
         }

         if (group.sourceInstallFolderPath) {
            if (signal.aborted) {
               return fail(operationId, {
                  code: 'filesystem.operation.cancelled',
                  message: 'shared content conversion was cancelled',
                  path: group.sourceInstallFolderPath
               });
            }

            const linked = await replaceInstallFolder(group.sourceInstallFolderPath, group.destinationPath, support.mode);
            if (Result.isError(linked)) return fail(operationId, linked.error);
            summary.folders += 1;
            summary.backups += 1;
         }
      }

      if (signal.aborted) {
         return fail(operationId, {
            code: 'filesystem.operation.cancelled',
            message: 'shared content conversion was cancelled',
            path: plan.sharedContentPath
         });
      }

      options.operations.complete(operationId, summary);
   }

   async function copyGroup(operationId: OperationId, group: ConversionGroup, offset: number, total: number, signal: AbortSignal) {
      const prepared = await Result.tryPromise({
         try: () => mkdir(group.destinationPath, { recursive: true }),
         catch: (cause) =>
            createFilesystemProblem('filesystem.operation.copy-failed', 'failed to create the library folder', group.destinationPath, cause)
      });
      if (Result.isError(prepared)) return Result.err<CopiedGroup, FilesystemProblem>(prepared.error);

      const entries = await Result.tryPromise({
         try: () => readdir(group.sourcePath),
         catch: (cause) => createFilesystemProblem('filesystem.path.inspect-failed', 'failed to read the linked folder', group.sourcePath, cause)
      });
      if (Result.isError(entries)) return Result.err<CopiedGroup, FilesystemProblem>(entries.error);

      let bytes = 0;
      let files = 0;
      let conflicts = 0;

      for (const name of entries.value) {
         const sourcePath = join(group.sourcePath, name);
         const libraryPath = join(group.destinationPath, name);
         const conflict = await pathExistsSafely(libraryPath);
         let destinationPath = libraryPath;
         let destinationRoot = group.sharedRootPath;

         if (conflict) {
            const preparedConflicts = await Result.tryPromise({
               try: () => mkdir(group.conflictPath, { recursive: true }),
               catch: (cause) =>
                  createFilesystemProblem('filesystem.operation.copy-failed', 'failed to create the conflict folder', group.conflictPath, cause)
            });
            if (Result.isError(preparedConflicts)) return Result.err<CopiedGroup, FilesystemProblem>(preparedConflicts.error);

            const uniquePath = await createUniquePath(join(group.conflictPath, name));
            if (Result.isError(uniquePath)) return Result.err<CopiedGroup, FilesystemProblem>(uniquePath.error);

            destinationPath = uniquePath.value;
            destinationRoot = group.conflictRootPath;
         }

         const copied = await copyPathWithProgress({
            sourcePath,
            destinationPath,
            destinationRoot,
            scope: 'content',
            signal,
            onProgress: (progress) => {
               const current = offset + bytes + (progress.current ?? 0);
               options.operations.update(operationId, {
                  progress: {
                     phase: conflict ? 'preserving-conflicts' : 'copying',
                     label: sharedFolderRelativePath(group.definition),
                     current,
                     total,
                     percent: total > 0 ? Math.min(100, (current / total) * 100) : 100,
                     unit: 'bytes'
                  }
               });
            }
         });
         if (Result.isError(copied)) return Result.err<CopiedGroup, FilesystemProblem>(copied.error);

         bytes += copied.value.bytes;
         files += copied.value.files;
         if (conflict) conflicts += 1;
      }

      return Result.ok<CopiedGroup, FilesystemProblem>({ bytes, files, conflicts });
   }

   function fail(operationId: OperationId, problem: FilesystemProblem) {
      options.operations.fail(operationId, {
         code: problem.code,
         message: problem.detail ? `${problem.message}: ${problem.detail}` : problem.message,
         details: { path: problem.path ?? null }
      });
   }

   return { start };
}

function conversionGroups(plan: ReadyBSManagerPlan, versions: BSManagerVersion[]) {
   const groups = new Map<string, ConversionGroup>();

   for (const version of versions) {
      for (const folder of version.folders) {
         if (folder.state !== 'foreign' || !folder.linkTargetPath) continue;
         const definition = findSharedFolderDefinition(folder.id);
         if (!definition) continue;

         const sourcePath = resolveFilesystemPath(folder.linkTargetPath);
         const key = `${definition.id}\0${sourcePath.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()}`;
         const folderPath = installFolderPath(version.path, definition);
         const group = groups.get(key);
         if (group) {
            group.linkPaths.push(folderPath);
            continue;
         }

         groups.set(key, {
            definition,
            sourcePath,
            destinationPath: sharedFolderPath(plan.sharedContentPath, definition),
            sharedRootPath: plan.sharedContentPath,
            conflictPath: conflictFolderPath(folderPath),
            conflictRootPath: version.path,
            linkPaths: [folderPath],
            sourceInstallFolderPath: null
         });
      }
   }

   for (const group of groups.values()) {
      for (const version of versions) {
         const folderPath = installFolderPath(version.path, group.definition);
         const folder = version.folders.find((candidate) => candidate.id === group.definition.id);
         if (folder?.state === 'unlinked' && isSamePath(folderPath, group.sourcePath)) {
            group.sourceInstallFolderPath = folderPath;
            break;
         }
      }
   }

   return [...groups.values()];
}

async function repointLink(folderPath: string, oldTargetPath: string, newTargetPath: string, mode: SharedLinkMode) {
   const current = await readFolderLink(folderPath, newTargetPath);
   if (current.state === 'linked') return Result.ok<void, FilesystemProblem>(undefined);
   if (current.state !== 'foreign' || !current.linkTargetPath || !isSamePath(current.linkTargetPath, oldTargetPath)) {
      return Result.err<void, FilesystemProblem>({
         code: 'filesystem.path.inspect-failed',
         message: 'the folder link changed during conversion',
         path: folderPath
      });
   }

   const removed = await removeFolderLink(folderPath);
   if (Result.isError(removed)) return removed;

   const linked = await createFolderLink(newTargetPath, folderPath, mode);
   if (Result.isOk(linked)) return linked;

   const restored = await createFolderLink(oldTargetPath, folderPath, mode);
   return Result.isError(restored) ? restored : linked;
}

async function replaceInstallFolder(folderPath: string, newTargetPath: string, mode: SharedLinkMode) {
   const current = await readFolderLink(folderPath, newTargetPath);
   if (current.state !== 'unlinked') {
      return Result.err<void, FilesystemProblem>({
         code: 'filesystem.path.inspect-failed',
         message: 'the install folder changed during conversion',
         path: folderPath
      });
   }

   const backupPath = await createUniquePath(backupFolderPath(folderPath));
   if (Result.isError(backupPath)) return Result.err<void, FilesystemProblem>(backupPath.error);

   const moved = await Result.tryPromise({
      try: () => rename(folderPath, backupPath.value),
      catch: (cause) => createFilesystemProblem('filesystem.operation.move-failed', 'failed to back up the install folder', folderPath, cause)
   });
   if (Result.isError(moved)) return Result.err<void, FilesystemProblem>(moved.error);

   const linked = await createFolderLink(newTargetPath, folderPath, mode);
   if (Result.isOk(linked)) return linked;

   const restored = await Result.tryPromise({
      try: () => rename(backupPath.value, folderPath),
      catch: (cause) => createFilesystemProblem('filesystem.operation.move-failed', 'failed to restore the install folder', folderPath, cause)
   });
   return Result.isError(restored) ? Result.err<void, FilesystemProblem>(restored.error) : linked;
}
