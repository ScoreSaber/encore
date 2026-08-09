import { Result } from 'better-result';

import { copyPathWithProgress, deletePathWithProgress, movePathWithProgress, type MovePathOptions } from '@/lib/filesystem/operations';
import { createFilesystemProblem, createUniquePath, pathExistsSafely, type FilesystemProblem } from '@/lib/filesystem/path';
import type { InstallSummary } from '@/modules/installs/contract';
import type { OperationProgress } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress } from '@/modules/operations/main/progress';
import type { ReadySharedContentPreview, SharedFolderDefinition, SharedFolderStatus, SharedLinkSupport } from '@/modules/shared-content/contract';
import { createFolderLink, removeFolderLink } from '@/modules/shared-content/main/folder-link';
import { conflictFolderPath } from '@/modules/shared-content/main/shared-paths';

import { mkdir, readdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

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
   mode: 'copy' | 'move';
   sourceDir: string;
   sourceRoot: string;
   destinationDir: string;
   destinationRoot: string;
   conflictDir: string | null;
   installPath: string;
   offset: number;
   total: number;
   phase: string;
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
            scope: 'content',
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
            scope: 'content',
            signal,
            onProgress: (progress) => reportProgress(operationId, 'deleting', offset + (progress.current ?? 0), total, previewed.relativePath)
         });
         if (Result.isError(deleted)) return Result.err(deleted.error);

         bytes = deleted.value.bytes;
         files = deleted.value.files;
      }

      if (context.state === 'unlinked' && previewed.contents === 'move') {
         const moved = await transferEntries({
            operationId,
            mode: 'move',
            sourceDir: context.folderPath,
            sourceRoot: context.install.path,
            destinationDir: context.sharedFolderPath,
            destinationRoot: context.sharedRootPath,
            conflictDir: conflictFolderPath(context.folderPath),
            installPath: context.install.path,
            offset,
            total,
            phase: 'moving',
            signal
         });
         if (Result.isError(moved)) return Result.err(moved.error);

         bytes = moved.value.bytes;
         files = moved.value.files;
         conflicts = moved.value.conflicts;

         const removed = await Result.tryPromise({
            try: () => rmdir(context.folderPath),
            catch: (cause) =>
               createFilesystemProblem('filesystem.operation.delete-failed', 'the folder still had files in it', context.folderPath, cause)
         });
         if (Result.isError(removed)) return Result.err(removed.error);
      }

      // create the link only after the install folder is empty, so it never overlays user content
      const linked = await createFolderLink(context.sharedFolderPath, context.folderPath, context.support.mode);
      if (Result.isError(linked)) return Result.err(linked.error);

      return Result.ok<ActionSummary, FilesystemProblem>({ bytes, files, conflicts, backupPath });
   }

   async function runUnlink(
      operationId: string,
      previewed: ReadySharedContentPreview,
      context: FolderContext,
      signal: AbortSignal,
      frame?: ProgressFrame
   ) {
      const removed = await removeFolderLink(context.folderPath);
      if (Result.isError(removed)) return Result.err(removed.error);

      const prepared = await ensureDirectory(context.folderPath);
      if (Result.isError(prepared)) return Result.err(prepared.error);

      if (previewed.contents === 'keep') return emptySummary();

      const transferred = await transferEntries({
         operationId,
         mode: previewed.contents === 'move' ? 'move' : 'copy',
         sourceDir: context.sharedFolderPath,
         sourceRoot: context.sharedRootPath,
         destinationDir: context.folderPath,
         destinationRoot: context.install.path,
         conflictDir: null,
         installPath: context.install.path,
         offset: frame?.offset ?? 0,
         total: frame?.total ?? previewed.sharedBytes,
         phase: previewed.contents === 'move' ? 'moving' : 'copying',
         signal
      });
      if (Result.isError(transferred)) return Result.err(transferred.error);

      return Result.ok<ActionSummary, FilesystemProblem>({ ...transferred.value, backupPath: null });
   }

   async function runRepair(context: FolderContext) {
      const removed = await removeFolderLink(context.folderPath);
      if (Result.isError(removed)) return Result.err(removed.error);

      const prepared = await ensureDirectory(context.sharedFolderPath);
      if (Result.isError(prepared)) return Result.err(prepared.error);

      const linked = await createFolderLink(context.sharedFolderPath, context.folderPath, context.support.mode);
      if (Result.isError(linked)) return Result.err(linked.error);

      return emptySummary();
   }

   async function transferEntries(transfer: TransferOptions) {
      const entries = await Result.tryPromise({
         try: () => readdir(transfer.sourceDir),
         catch: (cause) => createFilesystemProblem('filesystem.path.inspect-failed', 'failed to read the folder', transfer.sourceDir, cause)
      });
      if (Result.isError(entries)) return Result.err(entries.error);

      let bytes = 0;
      let files = 0;
      let conflicts = 0;
      let conflictDir: string | null = null;

      for (const name of entries.value) {
         const destinationPath = join(transfer.destinationDir, name);
         const taken = await pathExistsSafely(destinationPath);

         if (taken && !transfer.conflictDir) {
            conflicts += 1;
            continue;
         }

         if (taken && transfer.conflictDir) {
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
               scope: 'content',
               signal: transfer.signal
            });
            if (Result.isError(movedAside)) return Result.err(movedAside.error);

            conflicts += 1;
            continue;
         }

         const carried = bytes;
         const step: MovePathOptions = {
            sourcePath: join(transfer.sourceDir, name),
            destinationPath,
            destinationRoot: transfer.destinationRoot,
            sourceRoot: transfer.sourceRoot,
            scope: 'content',
            signal: transfer.signal,
            onProgress: (progress: OperationProgress) =>
               reportProgress(transfer.operationId, transfer.phase, transfer.offset + carried + (progress.current ?? 0), transfer.total, name)
         };
         const written = transfer.mode === 'move' ? await movePathWithProgress(step) : await copyPathWithProgress(step);
         if (Result.isError(written)) return Result.err(written.error);

         bytes += written.value.bytes;
         files += written.value.files;
      }

      return Result.ok<TransferSummary, FilesystemProblem>({ bytes, files, conflicts });
   }

   return { runLink, runUnlink, runRepair };
}

async function ensureDirectory(targetPath: string) {
   return Result.tryPromise({
      try: async () => {
         await mkdir(targetPath, { recursive: true });
      },
      catch: (cause) => createFilesystemProblem('filesystem.operation.copy-failed', 'failed to create the folder', targetPath, cause)
   });
}

function emptySummary() {
   return Result.ok<ActionSummary, FilesystemProblem>({ bytes: 0, files: 0, conflicts: 0, backupPath: null });
}
