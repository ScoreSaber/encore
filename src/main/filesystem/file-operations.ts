import { Result, type Err, type Ok } from 'better-result';

import { getDirectorySize } from '@/main/filesystem/directory-size';
import {
   assertCanCopyToDestination,
   createFilesystemProblem,
   createTempPath,
   normalizeFilesystemPath,
   pathExists,
   readPathInfo,
   resolveManagedPath,
   type FilesystemProblem,
   type ManagedPath
} from '@/main/filesystem/path-helpers';
import type { PathInfo } from '@/main/filesystem/path-helpers';
import { createWriteAuditEntry, finishWriteAuditEntry, type WriteAuditSink } from '@/main/filesystem/write-audit';
import type { OperationRegistry } from '@/main/operations/operation-registry';
import type { FilesystemWriteAction, FilesystemWriteScope } from '@/shared/filesystem';
import type { OperationError, OperationId, OperationProgress } from '@/shared/operations';

import { link, copyFile, mkdir, readdir, readlink, rename, rm, symlink, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type FilesystemProgressReporter = (progress: OperationProgress) => void;

export type FilesystemOperationTracker = {
   registry: OperationRegistry;
   operationId: OperationId;
};

export type FilesystemWriteOptions = {
   scope?: FilesystemWriteScope;
   audit?: WriteAuditSink;
   operation?: FilesystemOperationTracker;
   onProgress?: FilesystemProgressReporter;
   signal?: AbortSignal;
};

export type CopyPathOptions = FilesystemWriteOptions & {
   sourcePath: string;
   destinationPath: string;
   destinationRoot: string;
   sourceRoot?: string;
   overwrite?: boolean;
};

export type MovePathOptions = FilesystemWriteOptions & {
   sourcePath: string;
   destinationPath: string;
   destinationRoot: string;
   sourceRoot: string;
   overwrite?: boolean;
};

export type DeletePathOptions = FilesystemWriteOptions & {
   targetPath: string;
   root: string;
   allowMissing?: boolean;
};

export type FilesystemWriteSummary = {
   action: FilesystemWriteAction;
   sourcePath?: string;
   targetPath: string;
   bytes: number;
   files: number;
};

type FilesystemResult<T> = Ok<T, FilesystemProblem> | Err<T, FilesystemProblem>;
type FilesystemCountResult = FilesystemResult<{ bytes: number; files: number }>;
type VoidFilesystemResult = FilesystemResult<void>;

type CopyState = {
   bytes: number;
   files: number;
   totalBytes: number;
   totalFiles: number;
   report: FilesystemProgressReporter;
   signal?: AbortSignal;
};

type DeleteState = {
   bytes: number;
   files: number;
   totalBytes: number;
   totalFiles: number;
   report: FilesystemProgressReporter;
   signal?: AbortSignal;
};

const progressThrottleMs = 100;

export function createOperationProgressReporter(operation: FilesystemOperationTracker): FilesystemProgressReporter {
   return (progress) => {
      operation.registry.update(operation.operationId, { progress });
   };
}

export async function copyPathWithProgress(options: CopyPathOptions) {
   const prepared = await prepareCopy(options);
   if (Result.isError(prepared)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(prepared.error);

   return runAuditedWrite(
      {
         action: 'copy',
         sourcePath: prepared.value.sourcePath,
         targetPath: prepared.value.destinationPath,
         scope: options.scope ?? 'content',
         operationId: options.operation?.operationId,
         audit: options.audit
      },
      async () => {
         const summary = await performCopy({
            ...prepared.value,
            overwrite: options.overwrite ?? false,
            report: createProgressReporter(options, 'copying'),
            signal: options.signal
         });

         if (Result.isError(summary)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(summary.error);

         return Result.ok<FilesystemWriteSummary, FilesystemProblem>({
            action: 'copy',
            sourcePath: prepared.value.sourcePath,
            targetPath: prepared.value.destinationPath,
            bytes: summary.value.bytes,
            files: summary.value.files
         });
      },
      'filesystem.operation.copy-failed',
      'failed to copy filesystem path'
   );
}

export async function movePathWithProgress(options: MovePathOptions) {
   const prepared = await prepareCopy(options);
   if (Result.isError(prepared)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(prepared.error);

   return runAuditedWrite(
      {
         action: 'move',
         sourcePath: prepared.value.sourcePath,
         targetPath: prepared.value.destinationPath,
         scope: options.scope ?? 'content',
         operationId: options.operation?.operationId,
         audit: options.audit
      },
      async () => {
         const copySummary = await performCopy({
            ...prepared.value,
            overwrite: options.overwrite ?? false,
            report: createProgressReporter(options, 'copying'),
            signal: options.signal
         });

         if (Result.isError(copySummary)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(copySummary.error);

         const deleteSummary = await performDelete({
            targetPath: prepared.value.sourcePath,
            report: createProgressReporter(options, 'deleting', { keepComplete: true }),
            signal: options.signal
         });

         if (Result.isError(deleteSummary)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(deleteSummary.error);

         return Result.ok<FilesystemWriteSummary, FilesystemProblem>({
            action: 'move',
            sourcePath: prepared.value.sourcePath,
            targetPath: prepared.value.destinationPath,
            bytes: copySummary.value.bytes,
            files: Math.max(copySummary.value.files, deleteSummary.value.files)
         });
      },
      'filesystem.operation.move-failed',
      'failed to move filesystem path'
   );
}

export async function deletePathWithProgress(options: DeletePathOptions) {
   const target = await resolveManagedPath({
      root: options.root,
      path: options.targetPath
   });

   if (Result.isError(target)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(target.error);

   const exists = await pathExists(target.value.path);
   if (Result.isError(exists)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(exists.error);

   if (!exists.value && options.allowMissing) {
      return Result.ok<FilesystemWriteSummary, FilesystemProblem>({
         action: 'delete',
         targetPath: target.value.path,
         bytes: 0,
         files: 0
      });
   }

   if (!exists.value) {
      return Result.err<FilesystemWriteSummary, FilesystemProblem>({
         code: 'filesystem.path.not-found',
         message: 'filesystem path does not exist',
         path: target.value.path
      });
   }

   return runAuditedWrite(
      {
         action: 'delete',
         targetPath: target.value.path,
         scope: options.scope ?? 'content',
         operationId: options.operation?.operationId,
         audit: options.audit
      },
      async () => {
         const summary = await performDelete({
            targetPath: target.value.path,
            report: createProgressReporter(options, 'deleting'),
            signal: options.signal
         });

         if (Result.isError(summary)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(summary.error);

         return Result.ok<FilesystemWriteSummary, FilesystemProblem>({
            action: 'delete',
            targetPath: target.value.path,
            bytes: summary.value.bytes,
            files: summary.value.files
         });
      },
      'filesystem.operation.delete-failed',
      'failed to delete filesystem path'
   );
}

async function prepareCopy(options: CopyPathOptions | MovePathOptions) {
   const destination = await resolveManagedPath({
      root: options.destinationRoot,
      path: options.destinationPath
   });

   if (Result.isError(destination)) return Result.err<PreparedCopy, FilesystemProblem>(destination.error);

   const source = options.sourceRoot
      ? await resolveManagedPath({
           root: options.sourceRoot,
           path: options.sourcePath
        })
      : resolveUnmanagedSourcePath(options.sourcePath);

   if (Result.isError(source)) return Result.err<PreparedCopy, FilesystemProblem>(source.error);

   const sourceExists = await pathExists(source.value.path);
   if (Result.isError(sourceExists)) return Result.err<PreparedCopy, FilesystemProblem>(sourceExists.error);

   if (!sourceExists.value) {
      return Result.err<PreparedCopy, FilesystemProblem>({
         code: 'filesystem.path.not-found',
         message: 'copy source path does not exist',
         path: source.value.path
      });
   }

   const destinationExists = await pathExists(destination.value.path);
   if (Result.isError(destinationExists)) return Result.err<PreparedCopy, FilesystemProblem>(destinationExists.error);

   if (destinationExists.value && !options.overwrite) {
      return Result.err<PreparedCopy, FilesystemProblem>({
         code: 'filesystem.operation.destination-exists',
         message: 'destination already exists',
         path: destination.value.path
      });
   }

   const copyCheck = await assertCanCopyToDestination(source.value.path, destination.value.path);
   if (Result.isError(copyCheck)) return Result.err<PreparedCopy, FilesystemProblem>(copyCheck.error);

   return Result.ok<PreparedCopy, FilesystemProblem>({
      sourcePath: source.value.path,
      destinationPath: destination.value.path
   });
}

type PreparedCopy = {
   sourcePath: string;
   destinationPath: string;
};

function resolveUnmanagedSourcePath(sourcePath: string) {
   if (!sourcePath.trim()) {
      return Result.err<ManagedPath, FilesystemProblem>({
         code: 'filesystem.path.empty',
         message: 'copy source path is empty'
      });
   }

   const path = normalizeFilesystemPath(sourcePath);

   return Result.ok({
      root: dirname(path),
      path,
      relativePath: ''
   });
}

async function runAuditedWrite(
   input: {
      action: FilesystemWriteAction;
      scope: FilesystemWriteScope;
      targetPath: string;
      sourcePath?: string;
      operationId?: OperationId;
      audit?: WriteAuditSink;
   },
   write: () => Promise<FilesystemResult<FilesystemWriteSummary>>,
   errorCode: FilesystemProblem['code'],
   errorMessage: string
) {
   const auditEntry = createWriteAuditEntry(input);
   await writeAuditEntry(input.audit, auditEntry);

   const result = await Result.tryPromise({
      try: write,
      catch: (cause) => createFilesystemProblem(errorCode, errorMessage, input.targetPath, cause)
   });
   const writeResult = Result.isOk(result) ? result.value : Result.err<FilesystemWriteSummary, FilesystemProblem>(result.error);

   if (Result.isError(writeResult)) {
      await writeAuditEntry(
         input.audit,
         finishWriteAuditEntry(auditEntry, {
            status: writeResult.error.code === 'filesystem.operation.cancelled' ? 'cancelled' : 'failed',
            error: operationErrorFromProblem(writeResult.error)
         })
      );
      return writeResult;
   }

   await writeAuditEntry(
      input.audit,
      finishWriteAuditEntry(auditEntry, {
         status: 'completed',
         bytes: writeResult.value.bytes,
         files: writeResult.value.files
      })
   );

   return writeResult;
}

async function writeAuditEntry(audit: WriteAuditSink | undefined, entry: Parameters<WriteAuditSink>[0]) {
   if (!audit) return;

   await Result.tryPromise({
      try: async () => {
         await audit(entry);
      },
      catch: (cause: unknown) =>
         createFilesystemProblem('filesystem.operation.copy-failed', 'failed to write filesystem audit entry', entry.targetPath, cause)
   });
}

async function performCopy(
   input: PreparedCopy & { overwrite: boolean; report: FilesystemProgressReporter; signal?: AbortSignal }
): Promise<FilesystemCountResult> {
   const sourceInfo = await readPathInfo(input.sourcePath);
   if (Result.isError(sourceInfo)) return Result.err<{ bytes: number; files: number }, FilesystemProblem>(sourceInfo.error);

   const size = sourceInfo.value.kind === 'directory' ? await getDirectorySize(input.sourcePath) : getSingleNodeSize(sourceInfo.value);
   if (Result.isError(size)) return Result.err<{ bytes: number; files: number }, FilesystemProblem>(size.error);

   const state: CopyState = {
      bytes: 0,
      files: 0,
      totalBytes: size.value.bytes,
      totalFiles: size.value.files,
      report: input.report,
      signal: input.signal
   };

   const copyResult = await copyToDestination({ ...input, sourceInfo: sourceInfo.value }, state);
   if (Result.isError(copyResult)) return Result.err<{ bytes: number; files: number }, FilesystemProblem>(copyResult.error);

   return Result.ok<{ bytes: number; files: number }, FilesystemProblem>({
      bytes: state.bytes,
      files: state.files
   });
}

function getSingleNodeSize(sourceInfo: PathInfo): FilesystemCountResult {
   if (sourceInfo.kind === 'file') return Result.ok({ bytes: sourceInfo.sizeBytes, files: 1 });
   if (sourceInfo.kind === 'link') return Result.ok({ bytes: 0, files: 1 });
   return Result.ok({ bytes: 0, files: 0 });
}

async function performDelete(input: {
   targetPath: string;
   report: FilesystemProgressReporter;
   signal?: AbortSignal;
}): Promise<FilesystemCountResult> {
   const size = await getDirectorySize(input.targetPath);
   if (Result.isError(size)) return Result.err<{ bytes: number; files: number }, FilesystemProblem>(size.error);

   const state: DeleteState = {
      bytes: 0,
      files: 0,
      totalBytes: size.value.bytes,
      totalFiles: size.value.files,
      report: input.report,
      signal: input.signal
   };

   const deleteResult = await deleteNode(input.targetPath, state);
   if (Result.isError(deleteResult)) return Result.err<{ bytes: number; files: number }, FilesystemProblem>(deleteResult.error);

   reportProgress(state, 'deleting');

   return Result.ok<{ bytes: number; files: number }, FilesystemProblem>({
      bytes: state.bytes,
      files: state.files
   });
}

async function copyToDestination(
   input: PreparedCopy & { overwrite: boolean; report: FilesystemProgressReporter; signal?: AbortSignal; sourceInfo: PathInfo },
   state: CopyState
): Promise<VoidFilesystemResult> {
   const abort = getAbortProblem(input.signal);
   if (Result.isError(abort)) return abort;

   const parentResult = await runFilesystemStep(
      () => mkdir(dirname(input.destinationPath), { recursive: true }),
      'filesystem.operation.copy-failed',
      'failed to prepare copy destination',
      input.destinationPath
   );
   if (Result.isError(parentResult)) return Result.err<void, FilesystemProblem>(parentResult.error);

   if (!input.overwrite && input.sourceInfo.kind === 'directory') {
      return copyDirectoryToReservedDestination(input, state);
   }

   const temporaryPath = createTempPath({
      parentPath: dirname(input.destinationPath),
      prefix: 'copy'
   });
   const copyResult = await copyNode(input.sourcePath, temporaryPath, state);
   if (Result.isError(copyResult)) {
      await cleanupPath(temporaryPath);
      return copyResult;
   }

   const installResult = input.overwrite
      ? await replaceDestinationWithTemporary(input, temporaryPath)
      : await installTemporaryWithoutOverwrite(input, temporaryPath);

   if (Result.isError(installResult)) {
      await cleanupPath(temporaryPath);
      return installResult;
   }

   await cleanupPath(temporaryPath);
   reportProgress(state, 'copying');
   return Result.ok<void, FilesystemProblem>(undefined);
}

async function copyDirectoryToReservedDestination(
   input: PreparedCopy & { overwrite: boolean; report: FilesystemProgressReporter; signal?: AbortSignal; sourceInfo: PathInfo },
   state: CopyState
): Promise<VoidFilesystemResult> {
   const reserveResult = await runFilesystemStep(
      () => mkdir(input.destinationPath),
      'filesystem.operation.copy-failed',
      'failed to reserve copy destination',
      input.destinationPath
   );
   if (Result.isError(reserveResult)) return destinationExistsFromProblem(reserveResult.error);

   const copyResult = await copyNode(input.sourcePath, input.destinationPath, state);
   if (Result.isError(copyResult)) {
      await cleanupPath(input.destinationPath);
      return copyResult;
   }

   const abort = getAbortProblem(input.signal);
   if (Result.isError(abort)) {
      await cleanupPath(input.destinationPath);
      return abort;
   }

   reportProgress(state, 'copying');
   return Result.ok<void, FilesystemProblem>(undefined);
}

async function installTemporaryWithoutOverwrite(
   input: PreparedCopy & { overwrite: boolean; report: FilesystemProgressReporter; signal?: AbortSignal; sourceInfo: PathInfo },
   temporaryPath: string
): Promise<VoidFilesystemResult> {
   const abort = getAbortProblem(input.signal);
   if (Result.isError(abort)) return abort;

   if (input.sourceInfo.kind === 'file') {
      const linkResult = await runFilesystemStep(
         () => link(temporaryPath, input.destinationPath),
         'filesystem.operation.copy-failed',
         'failed to install copied file',
         input.destinationPath
      );
      return Result.isError(linkResult) ? destinationExistsFromProblem(linkResult.error) : Result.ok<void, FilesystemProblem>(undefined);
   }

   if (input.sourceInfo.kind === 'link') {
      const target = await runFilesystemStep(
         () => readlink(temporaryPath),
         'filesystem.operation.copy-failed',
         'failed to read temporary copied link',
         temporaryPath
      );
      if (Result.isError(target)) return Result.err<void, FilesystemProblem>(target.error);

      const linkResult = await runFilesystemStep(
         () => symlink(target.value, input.destinationPath, symlinkTypeForTarget(input.sourceInfo)),
         'filesystem.operation.copy-failed',
         'failed to install copied link',
         input.destinationPath
      );
      return Result.isError(linkResult) ? destinationExistsFromProblem(linkResult.error) : Result.ok<void, FilesystemProblem>(undefined);
   }

   return Result.ok<void, FilesystemProblem>(undefined);
}

async function replaceDestinationWithTemporary(
   input: PreparedCopy & { overwrite: boolean; report: FilesystemProgressReporter; signal?: AbortSignal; sourceInfo: PathInfo },
   temporaryPath: string
): Promise<VoidFilesystemResult> {
   const abort = getAbortProblem(input.signal);
   if (Result.isError(abort)) return abort;

   const destinationExists = await pathExists(input.destinationPath);
   if (Result.isError(destinationExists)) return Result.err<void, FilesystemProblem>(destinationExists.error);

   const backupPath = destinationExists.value
      ? createTempPath({
           parentPath: dirname(input.destinationPath),
           prefix: 'replace',
           suffix: '.bak'
        })
      : null;

   if (backupPath) {
      const backupResult = await runFilesystemStep(
         () => rename(input.destinationPath, backupPath),
         'filesystem.operation.copy-failed',
         'failed to move existing destination aside',
         input.destinationPath
      );
      if (Result.isError(backupResult)) return backupResult;

      const abortAfterBackup = getAbortProblem(input.signal);
      if (Result.isError(abortAfterBackup)) {
         const restoreResult = await restoreDestinationBackup(backupPath, input.destinationPath);
         return Result.isError(restoreResult) ? restoreResult : abortAfterBackup;
      }
   }

   const renameResult = await runFilesystemStep(
      () => rename(temporaryPath, input.destinationPath),
      'filesystem.operation.copy-failed',
      'failed to move copy into place',
      input.destinationPath
   );

   if (Result.isError(renameResult)) {
      if (backupPath) await restoreDestinationBackup(backupPath, input.destinationPath);
      return renameResult;
   }

   if (backupPath) await cleanupPath(backupPath);
   return Result.ok<void, FilesystemProblem>(undefined);
}

async function restoreDestinationBackup(backupPath: string, destinationPath: string) {
   return runFilesystemStep(
      () => rename(backupPath, destinationPath),
      'filesystem.operation.copy-failed',
      'failed to restore replaced destination',
      destinationPath
   );
}

function destinationExistsFromProblem(problem: FilesystemProblem): VoidFilesystemResult {
   if (problem.detail !== 'EEXIST') return Result.err<void, FilesystemProblem>(problem);

   return Result.err<void, FilesystemProblem>({
      code: 'filesystem.operation.destination-exists',
      message: 'destination already exists',
      path: problem.path
   });
}

function symlinkTypeForTarget(sourceInfo: PathInfo) {
   return process.platform === 'win32' && sourceInfo.targetKind === 'directory' ? 'junction' : undefined;
}

async function copyNode(sourcePath: string, destinationPath: string, state: CopyState): Promise<VoidFilesystemResult> {
   const abort = getAbortProblem(state.signal);
   if (Result.isError(abort)) return abort;

   const sourceInfo = await readPathInfo(sourcePath);
   if (Result.isError(sourceInfo)) return Result.err<void, FilesystemProblem>(sourceInfo.error);

   if (sourceInfo.value.kind === 'directory') {
      const mkdirResult = await runFilesystemStep(
         () => mkdir(destinationPath, { recursive: true }),
         'filesystem.operation.copy-failed',
         'failed to create copied directory',
         destinationPath
      );
      if (Result.isError(mkdirResult)) return Result.err<void, FilesystemProblem>(mkdirResult.error);

      const entries = await runFilesystemStep(
         () => readdir(sourcePath, { withFileTypes: true }),
         'filesystem.operation.copy-failed',
         'failed to list copied directory',
         sourcePath
      );
      if (Result.isError(entries)) return Result.err<void, FilesystemProblem>(entries.error);

      for (const entry of entries.value) {
         const childResult = await copyNode(join(sourcePath, entry.name), join(destinationPath, entry.name), state);
         if (Result.isError(childResult)) return childResult;
      }

      return Result.ok<void, FilesystemProblem>(undefined);
   }

   if (sourceInfo.value.kind === 'link') {
      const target = await runFilesystemStep(
         () => readlink(sourcePath),
         'filesystem.operation.copy-failed',
         'failed to read copied link',
         sourcePath
      );
      if (Result.isError(target)) return Result.err<void, FilesystemProblem>(target.error);

      const linkResult = await runFilesystemStep(
         () => symlink(target.value, destinationPath, symlinkTypeForTarget(sourceInfo.value)),
         'filesystem.operation.copy-failed',
         'failed to create copied link',
         destinationPath
      );
      if (Result.isError(linkResult)) return linkResult;

      state.files += 1;
      reportProgress(state, 'copying');
      return Result.ok<void, FilesystemProblem>(undefined);
   }

   if (sourceInfo.value.kind !== 'file') return Result.ok<void, FilesystemProblem>(undefined);

   const fileResult = await runFilesystemStep(
      () => copyFile(sourcePath, destinationPath),
      'filesystem.operation.copy-failed',
      'failed to copy file',
      destinationPath
   );
   if (Result.isError(fileResult)) return fileResult;

   state.bytes += sourceInfo.value.sizeBytes;
   state.files += 1;
   reportProgress(state, 'copying');

   return Result.ok<void, FilesystemProblem>(undefined);
}

async function deleteNode(targetPath: string, state: DeleteState): Promise<VoidFilesystemResult> {
   const abort = getAbortProblem(state.signal);
   if (Result.isError(abort)) return abort;

   const info = await readPathInfo(targetPath);
   if (Result.isError(info)) return Result.err<void, FilesystemProblem>(info.error);

   if (info.value.kind === 'directory') {
      const entries = await runFilesystemStep(
         () => readdir(targetPath, { withFileTypes: true }),
         'filesystem.operation.delete-failed',
         'failed to list directory before deleting it',
         targetPath
      );
      if (Result.isError(entries)) return Result.err<void, FilesystemProblem>(entries.error);

      for (const entry of entries.value) {
         const childResult = await deleteNode(join(targetPath, entry.name), state);
         if (Result.isError(childResult)) return childResult;
      }

      const removeDirectoryResult = await runFilesystemStep(
         () => rm(targetPath, { recursive: true, maxRetries: 5, retryDelay: 100 }),
         'filesystem.operation.delete-failed',
         'failed to remove directory',
         targetPath
      );
      if (Result.isError(removeDirectoryResult)) return removeDirectoryResult;

      return Result.ok<void, FilesystemProblem>(undefined);
   }

   const unlinkResult = await runFilesystemStep(
      () => unlink(targetPath),
      'filesystem.operation.delete-failed',
      'failed to remove filesystem node',
      targetPath
   );
   if (Result.isError(unlinkResult)) return unlinkResult;

   state.bytes += info.value.kind === 'file' ? info.value.sizeBytes : 0;
   state.files += 1;
   reportProgress(state, 'deleting');

   return Result.ok<void, FilesystemProblem>(undefined);
}

function createProgressReporter(
   options: FilesystemWriteOptions,
   phase: string,
   progressOptions: { keepComplete?: boolean } = {}
): FilesystemProgressReporter {
   const operationReporter = options.operation ? createOperationProgressReporter(options.operation) : null;
   let lastProgressAt = 0;

   return (progress) => {
      const complete = (progress.percent ?? 0) >= 100;
      const now = Date.now();
      if (!complete && now - lastProgressAt < progressThrottleMs) return;
      lastProgressAt = now;

      const nextProgress = {
         ...progress,
         ...(progressOptions.keepComplete ? { current: progress.total, percent: 100 } : {}),
         phase
      };

      options.onProgress?.(nextProgress);
      operationReporter?.(nextProgress);
   };
}

function reportProgress(state: CopyState | DeleteState, phase: string) {
   state.report({
      phase,
      current: state.bytes,
      total: state.totalBytes,
      percent: state.totalBytes > 0 ? Math.min(100, Math.round((state.bytes / state.totalBytes) * 100)) : 100,
      unit: 'bytes',
      label: `${state.files}/${state.totalFiles} files`
   });
}

function getAbortProblem(signal?: AbortSignal): VoidFilesystemResult {
   if (!signal?.aborted) return Result.ok<void, FilesystemProblem>(undefined);

   return Result.err<void, FilesystemProblem>({
      code: 'filesystem.operation.cancelled',
      message: 'filesystem operation was cancelled'
   });
}

function operationErrorFromProblem(problem: FilesystemProblem): OperationError {
   return {
      code: problem.code,
      message: problem.message,
      details: {
         path: problem.path,
         root: problem.root,
         detail: problem.detail
      }
   };
}

async function cleanupPath(targetPath: string) {
   await Result.tryPromise({
      try: () => rm(targetPath, { recursive: true, force: true }),
      catch: (cause) => createFilesystemProblem('filesystem.operation.delete-failed', 'failed to clean up filesystem path', targetPath, cause)
   });
}

async function runFilesystemStep<T>(
   task: () => Promise<T>,
   code: FilesystemProblem['code'],
   message: string,
   targetPath: string
): Promise<FilesystemResult<T>> {
   return Result.tryPromise({
      try: task,
      catch: (cause) => createFilesystemProblem(code, message, targetPath, cause)
   });
}
