import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { copyPathWithProgress, deletePathWithProgress, movePathWithProgress } from '@/lib/filesystem/operations';
import { createTempPath, createUniquePath, pathExistsSafely, removeQuietly } from '@/lib/filesystem/path';
import type { InstallSummary } from '@/modules/installs/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress } from '@/modules/operations/main/operation-reporting';
import type { ReadySharedContentPreview, SharedFolderDefinition, SharedFolderStatus, SharedLinkSupport } from '@/modules/shared-content/contract';
import { createFolderLink, removeFolderLink } from '@/modules/shared-content/main/folder-link';
import { conflictFolderPath } from '@/modules/shared-content/main/shared-paths';

import { mkdir, readdir, rename, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type FolderContext = {
   install: InstallSummary;
   sharedRootPath: string;
   definition: SharedFolderDefinition;
   folderPath: string;
   sharedFolderPath: string;
   state: SharedFolderStatus['state'];
   // the known root a healthy link actually points into, when it is not the requested one
   linkedRootPath: string | null;
   support: SharedLinkSupport;
};

type ActionSummary = { bytes: number; files: number; conflicts: number; backupPath: string | null };

// bulk runs report against one shared total, with the bytes finished by earlier folders as offset
type ProgressFrame = { offset: number; total: number };

type TransferSummary = { bytes: number; files: number; conflicts: number };

type TransferOptions = {
   operationId: string;
   sourceDir: string;
   sourceRoot: string;
   destinationDir: string;
   destinationRoot: string;
   conflictDir: string;
   installPath: string;
   offset: number;
   total: number;
   signal: AbortSignal;
};

export function createSharedContentTransfers(operations: OperationRegistry) {
   const reportProgress = createBytesProgress(operations);

   async function runLink(
      operationId: string,
      previewed: ReadySharedContentPreview,
      context: FolderContext,
      signal: AbortSignal,
      frame?: ProgressFrame
   ) {
      const offset = frame?.offset ?? 0;
      const total = frame?.total ?? previewed.installBytes;
      const prepared = await ensureDirectory(context.sharedFolderPath);
      if (Result.isError(prepared)) return Result.err(prepared.error);

      let bytes = 0;
      let files = 0;
      let conflicts = 0;
      let backupPath: string | null = null;

      if (context.state === 'unlinked' && previewed.backupPath) {
         const backup = await createUniquePath(previewed.backupPath);
         if (Result.isError(backup)) return Result.err(backup.error);

         const copied = await copyPathWithProgress({
            sourcePath: context.folderPath,
            destinationPath: backup.value,
            destinationRoot: context.install.path,
            sourceRoot: context.install.path,
            signal,
            onProgress: (progress) => reportProgress(operationId, 'backing-up', offset + (progress.current ?? 0), total, previewed.relativePath)
         });
         if (Result.isError(copied)) return Result.err(copied.error);

         backupPath = backup.value;
      }

      if (context.state === 'unlinked' && previewed.contents === 'discard') {
         const deleted = await deletePathWithProgress({
            targetPath: context.folderPath,
            root: context.install.path,
            allowMissing: true,
            signal,
            onProgress: (progress) => reportProgress(operationId, 'deleting', offset + (progress.current ?? 0), total, previewed.relativePath)
         });
         if (Result.isError(deleted)) return Result.err(deleted.error);

         bytes = deleted.value.bytes;
         files = deleted.value.files;
      }

      if (context.state === 'unlinked' && previewed.contents === 'move') {
         const moved = await moveEntries({
            operationId,
            sourceDir: context.folderPath,
            sourceRoot: context.install.path,
            destinationDir: context.sharedFolderPath,
            destinationRoot: context.sharedRootPath,
            conflictDir: conflictFolderPath(context.folderPath),
            installPath: context.install.path,
            offset,
            total,
            signal
         });
         if (Result.isError(moved)) return Result.err(moved.error);

         bytes = moved.value.bytes;
         files = moved.value.files;
         conflicts = moved.value.conflicts;

         const removed = await Result.tryPromise({
            try: () => rmdir(context.folderPath),
            catch: (cause) => createProblem('shared.folder.not-empty', { path: context.folderPath, cause })
         });
         if (Result.isError(removed)) return Result.err(removed.error);
      }

      // create the link only after the install folder is empty, so it never overlays user content
      const linked = await createFolderLink(context.sharedFolderPath, context.folderPath, context.support.mode);
      if (Result.isError(linked)) return Result.err(linked.error);

      return Result.ok<ActionSummary, Problem>({ bytes, files, conflicts, backupPath });
   }

   async function runUnlink(
      operationId: string,
      previewed: ReadySharedContentPreview,
      context: FolderContext,
      signal: AbortSignal,
      frame?: ProgressFrame
   ) {
      const stagingPath = createTempPath({ parentPath: dirname(context.folderPath), prefix: 'encore-unlink', suffix: '' });
      const copying = previewed.contents !== 'keep' && (await pathExistsSafely(context.sharedFolderPath));
      const phase = previewed.contents === 'move' ? 'moving' : 'copying';
      let bytes = 0;
      let files = 0;

      if (copying) {
         const copied = await copyPathWithProgress({
            sourcePath: context.sharedFolderPath,
            sourceRoot: context.sharedRootPath,
            destinationPath: stagingPath,
            destinationRoot: context.install.path,
            signal,
            onProgress: (progress) =>
               reportProgress(
                  operationId,
                  phase,
                  (frame?.offset ?? 0) + (progress.current ?? 0),
                  frame?.total ?? previewed.sharedBytes,
                  previewed.relativePath
               )
         });
         if (Result.isError(copied)) {
            await removeQuietly(stagingPath);
            return Result.err(copied.error);
         }

         bytes = copied.value.bytes;
         files = copied.value.files;
      } else {
         const prepared = await ensureDirectory(stagingPath);
         if (Result.isError(prepared)) return Result.err(prepared.error);
      }

      if (signal.aborted) {
         await removeQuietly(stagingPath);
         return Result.err<ActionSummary, Problem>(createProblem('filesystem.operation.cancelled'));
      }

      const removed = await removeFolderLink(context.folderPath);
      if (Result.isError(removed)) {
         await removeQuietly(stagingPath);
         return Result.err(removed.error);
      }

      const published = await Result.tryPromise({
         try: () => rename(stagingPath, context.folderPath),
         catch: (cause): Problem => createProblem('shared.folder.create-failed', { path: context.folderPath, cause })
      });
      if (Result.isError(published)) {
         const restored = await createFolderLink(context.sharedFolderPath, context.folderPath, context.support.mode);
         if (Result.isOk(restored)) await removeQuietly(stagingPath);
         return Result.err(published.error);
      }

      if (copying && previewed.contents === 'move') {
         const drained = await drainEntries(context, signal);
         if (Result.isError(drained)) return Result.err(drained.error);
      }

      return Result.ok<ActionSummary, Problem>({ bytes, files, conflicts: 0, backupPath: null });
   }

   async function runRepair(context: FolderContext) {
      const removed = await removeFolderLink(context.folderPath);
      if (Result.isError(removed)) return Result.err(removed.error);

      const prepared = await ensureDirectory(context.sharedFolderPath);
      if (Result.isError(prepared)) return Result.err(prepared.error);

      const linked = await createFolderLink(context.sharedFolderPath, context.folderPath, context.support.mode);
      if (Result.isError(linked)) return Result.err(linked.error);

      return Result.ok<ActionSummary, Problem>({ bytes: 0, files: 0, conflicts: 0, backupPath: null });
   }

   async function moveEntries(transfer: TransferOptions) {
      const entries = await readNames(transfer.sourceDir);
      if (Result.isError(entries)) return Result.err(entries.error);

      let bytes = 0;
      let files = 0;
      let conflicts = 0;
      let conflictDir: string | null = null;

      for (const name of entries.value) {
         const destinationPath = join(transfer.destinationDir, name);

         if (await pathExistsSafely(destinationPath)) {
            if (!conflictDir) {
               const created = await createUniquePath(transfer.conflictDir);
               if (Result.isError(created)) return Result.err(created.error);

               const prepared = await ensureDirectory(created.value);
               if (Result.isError(prepared)) return Result.err(prepared.error);

               conflictDir = created.value;
            }

            const movedAside = await movePathWithProgress({
               sourcePath: join(transfer.sourceDir, name),
               destinationPath: join(conflictDir, name),
               destinationRoot: transfer.installPath,
               sourceRoot: transfer.installPath,
               signal: transfer.signal
            });
            if (Result.isError(movedAside)) return Result.err(movedAside.error);

            conflicts += 1;
            continue;
         }

         const carried = bytes;
         const moved = await movePathWithProgress({
            sourcePath: join(transfer.sourceDir, name),
            destinationPath,
            destinationRoot: transfer.destinationRoot,
            sourceRoot: transfer.sourceRoot,
            signal: transfer.signal,
            onProgress: (progress) =>
               reportProgress(transfer.operationId, 'moving', transfer.offset + carried + (progress.current ?? 0), transfer.total, name)
         });
         if (Result.isError(moved)) return Result.err(moved.error);

         bytes += moved.value.bytes;
         files += moved.value.files;
      }

      return Result.ok<TransferSummary, Problem>({ bytes, files, conflicts });
   }

   return { runLink, runUnlink, runRepair };
}

async function ensureDirectory(targetPath: string) {
   return Result.tryPromise({
      try: async () => {
         await mkdir(targetPath, { recursive: true });
      },
      catch: (cause): Problem => createProblem('shared.folder.create-failed', { path: targetPath, cause })
   });
}

async function drainEntries(context: FolderContext, signal: AbortSignal) {
   const copied = await readNames(context.folderPath);
   if (Result.isError(copied)) return Result.err(copied.error);

   for (const name of copied.value) {
      const deleted = await deletePathWithProgress({
         targetPath: join(context.sharedFolderPath, name),
         root: context.sharedRootPath,
         allowMissing: true,
         signal
      });
      if (Result.isError(deleted)) return Result.err(deleted.error);
   }

   return Result.ok<void, Problem>(undefined);
}

async function readNames(targetPath: string) {
   return Result.tryPromise({
      try: () => readdir(targetPath),
      catch: (cause): Problem => createProblem('shared.folder.unreadable', { path: targetPath, cause })
   });
}
