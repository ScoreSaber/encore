import { Result } from 'better-result';

import { abortableSleep } from '@/lib/async';
import { causeCode, createProblem } from '@/lib/errors';
import { publishFileExclusive } from '@/lib/filesystem/atomic-write';
import {
   assertCanCopyToDestination,
   createTempPath,
   resolveFilesystemPath,
   pathExists,
   readPathInfo,
   removeQuietly,
   resolveManagedPath,
   type FilesystemProblem,
   type ManagedPath,
   type PathInfo
} from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import { bytesProgress, throttleReports } from '@/lib/progress';
import type { OperationProgress } from '@/modules/operations/contract';

import { copyFile, mkdir, readdir, readlink, rename, rm, symlink, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type ProgressReporter = (progress: OperationProgress) => void;

type FilesystemWriteOptions = {
   onProgress?: ProgressReporter;
   signal?: AbortSignal;
};

type CopyPathOptions = FilesystemWriteOptions & {
   sourcePath: string;
   destinationPath: string;
   destinationRoot: string;
   sourceRoot?: string;
   overwrite?: boolean;
};

type MovePathOptions = FilesystemWriteOptions & {
   sourcePath: string;
   destinationPath: string;
   destinationRoot: string;
   sourceRoot: string;
   overwrite?: boolean;
};

type DeletePathOptions = FilesystemWriteOptions & {
   targetPath: string;
   root: string;
   allowMissing?: boolean;
};

export type FilesystemWriteSummary = {
   action: 'copy' | 'move' | 'delete';
   sourcePath?: string;
   targetPath: string;
   bytes: number;
   files: number;
};

type WriteTally = { bytes: number; files: number };

type WriteState = WriteTally & {
   totalBytes: number;
   totalFiles: number;
   report: ProgressReporter;
   signal?: AbortSignal;
};

const copyRetryDelaysMs = [100, 250, 500, 1_000, 2_000];

export async function copyPathWithProgress(options: CopyPathOptions) {
   const prepared = await prepareCopy(options);
   if (Result.isError(prepared)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(prepared.error);

   return guardWrite(
      prepared.value.destinationPath,
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
      'filesystem.operation.copy-failed'
   );
}

export async function movePathWithProgress(options: MovePathOptions) {
   const prepared = await prepareCopy(options);
   if (Result.isError(prepared)) return Result.err<FilesystemWriteSummary, FilesystemProblem>(prepared.error);

   return guardWrite(
      prepared.value.destinationPath,
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
      'filesystem.operation.move-failed'
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
      return Result.err<FilesystemWriteSummary, FilesystemProblem>(createProblem('filesystem.path.not-found', { path: target.value.path }));
   }

   return guardWrite(
      target.value.path,
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
      'filesystem.operation.delete-failed'
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
      return Result.err<PreparedCopy, FilesystemProblem>(createProblem('filesystem.path.not-found', { path: source.value.path }));
   }

   const destinationExists = await pathExists(destination.value.path);
   if (Result.isError(destinationExists)) return Result.err<PreparedCopy, FilesystemProblem>(destinationExists.error);

   if (destinationExists.value && !options.overwrite) {
      return Result.err<PreparedCopy, FilesystemProblem>(createProblem('filesystem.operation.destination-exists', { path: destination.value.path }));
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

type CopyRequest = PreparedCopy & { overwrite: boolean; report: ProgressReporter; signal?: AbortSignal };

type CopyInput = CopyRequest & { sourceInfo: PathInfo };

function resolveUnmanagedSourcePath(sourcePath: string) {
   if (!sourcePath.trim()) {
      return Result.err<ManagedPath, FilesystemProblem>(createProblem('filesystem.path.empty'));
   }

   const path = resolveFilesystemPath(sourcePath);

   return Result.ok({
      root: dirname(path),
      path,
      relativePath: ''
   });
}

async function guardWrite(
   targetPath: string,
   write: () => Promise<Result<FilesystemWriteSummary, FilesystemProblem>>,
   errorCode: FilesystemProblem['code']
) {
   const result = await Result.tryPromise({
      try: write,
      catch: (cause) => createProblem(errorCode, { path: targetPath, cause })
   });
   return Result.flatten(result);
}

async function performCopy(input: CopyRequest): Promise<Result<WriteTally, FilesystemProblem>> {
   const sourceInfo = await readPathInfo(input.sourcePath);
   if (Result.isError(sourceInfo)) return Result.err(sourceInfo.error);

   const size = sourceInfo.value.kind === 'directory' ? await getDirectorySize(input.sourcePath) : getSingleNodeSize(sourceInfo.value);
   if (Result.isError(size)) return Result.err(size.error);

   const state: WriteState = {
      bytes: 0,
      files: 0,
      totalBytes: size.value.bytes,
      totalFiles: size.value.files,
      report: input.report,
      signal: input.signal
   };

   const copyResult = await copyToDestination({ ...input, sourceInfo: sourceInfo.value }, state);
   if (Result.isError(copyResult)) return Result.err(copyResult.error);

   return Result.ok({ bytes: state.bytes, files: state.files });
}

function getSingleNodeSize(sourceInfo: PathInfo): Result<WriteTally, FilesystemProblem> {
   if (sourceInfo.kind === 'file') return Result.ok({ bytes: sourceInfo.sizeBytes, files: 1 });
   if (sourceInfo.kind === 'link') return Result.ok({ bytes: 0, files: 1 });
   return Result.ok({ bytes: 0, files: 0 });
}

async function performDelete(input: {
   targetPath: string;
   report: ProgressReporter;
   signal?: AbortSignal;
}): Promise<Result<WriteTally, FilesystemProblem>> {
   const size = await getDirectorySize(input.targetPath);
   if (Result.isError(size)) return Result.err(size.error);

   const state: WriteState = {
      bytes: 0,
      files: 0,
      totalBytes: size.value.bytes,
      totalFiles: size.value.files,
      report: input.report,
      signal: input.signal
   };

   const deleteResult = await deleteNode(input.targetPath, state);
   if (Result.isError(deleteResult)) return Result.err(deleteResult.error);

   reportProgress(state, 'deleting');

   return Result.ok({ bytes: state.bytes, files: state.files });
}

async function copyToDestination(input: CopyInput, state: WriteState): Promise<Result<void, FilesystemProblem>> {
   const abort = getAbortProblem(input.signal);
   if (Result.isError(abort)) return abort;

   const parentResult = await runFilesystemStep(
      () => mkdir(dirname(input.destinationPath), { recursive: true }),
      'filesystem.operation.copy-failed',
      input.destinationPath
   );
   if (Result.isError(parentResult)) return Result.err<void, FilesystemProblem>(parentResult.error);

   const temporaryPath = createTempPath({
      parentPath: dirname(input.destinationPath),
      prefix: 'copy'
   });
   const copyResult = await copyNode(input.sourcePath, temporaryPath, state);
   if (Result.isError(copyResult)) {
      await removeQuietly(temporaryPath);
      return copyResult;
   }

   const installResult = input.overwrite
      ? await replaceDestinationWithTemporary(input, temporaryPath)
      : await installTemporaryWithoutOverwrite(input, temporaryPath);

   if (Result.isError(installResult)) {
      await removeQuietly(temporaryPath);
      return installResult;
   }

   await removeQuietly(temporaryPath);
   reportProgress(state, 'copying');
   return Result.ok<void, FilesystemProblem>(undefined);
}

async function installTemporaryWithoutOverwrite(input: CopyInput, temporaryPath: string): Promise<Result<void, FilesystemProblem>> {
   const abort = getAbortProblem(input.signal);
   if (Result.isError(abort)) return abort;

   const publish = (task: () => Promise<void>) => runFilesystemStep(task, 'filesystem.operation.copy-failed', input.destinationPath);

   if (input.sourceInfo.kind === 'directory') return withDestinationExists(await publish(() => rename(temporaryPath, input.destinationPath)));

   if (input.sourceInfo.kind === 'file') {
      return withDestinationExists(await publish(() => publishFileExclusive(temporaryPath, input.destinationPath)));
   }

   if (input.sourceInfo.kind === 'link') {
      const target = await runFilesystemStep(() => readlink(temporaryPath), 'filesystem.operation.copy-failed', temporaryPath);
      if (Result.isError(target)) return Result.err<void, FilesystemProblem>(target.error);

      return withDestinationExists(await publish(() => symlink(target.value, input.destinationPath, symlinkTypeForTarget(input.sourceInfo))));
   }

   return Result.ok<void, FilesystemProblem>(undefined);
}

async function replaceDestinationWithTemporary(input: CopyInput, temporaryPath: string): Promise<Result<void, FilesystemProblem>> {
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
         input.destinationPath
      );
      if (Result.isError(backupResult)) return backupResult;

      const abortAfterBackup = getAbortProblem(input.signal);
      if (Result.isError(abortAfterBackup)) {
         const restoreResult = await runFilesystemStep(
            () => rename(backupPath, input.destinationPath),
            'filesystem.operation.copy-failed',
            input.destinationPath
         );
         return Result.isError(restoreResult) ? restoreResult : abortAfterBackup;
      }
   }

   const renameResult = await runFilesystemStep(
      () => rename(temporaryPath, input.destinationPath),
      'filesystem.operation.copy-failed',
      input.destinationPath
   );

   if (Result.isError(renameResult)) {
      if (backupPath) {
         await runFilesystemStep(() => rename(backupPath, input.destinationPath), 'filesystem.operation.copy-failed', input.destinationPath);
      }
      return renameResult;
   }

   if (backupPath) await removeQuietly(backupPath);
   return Result.ok<void, FilesystemProblem>(undefined);
}

function withDestinationExists(result: Result<void, FilesystemProblem>): Result<void, FilesystemProblem> {
   if (Result.isOk(result)) return result;

   const { detail, path } = result.error;
   if (detail !== 'EEXIST' && detail !== 'ENOTEMPTY') return result;

   return Result.err<void, FilesystemProblem>(createProblem('filesystem.operation.destination-exists', path ? { path } : {}));
}

function symlinkTypeForTarget(sourceInfo: PathInfo) {
   return process.platform === 'win32' && sourceInfo.targetKind === 'directory' ? 'junction' : undefined;
}

async function copyNode(sourcePath: string, destinationPath: string, state: WriteState): Promise<Result<void, FilesystemProblem>> {
   const abort = getAbortProblem(state.signal);
   if (Result.isError(abort)) return abort;

   const sourceInfo = await readPathInfo(sourcePath);
   if (Result.isError(sourceInfo)) return Result.err<void, FilesystemProblem>(sourceInfo.error);

   if (sourceInfo.value.kind === 'directory') {
      const mkdirResult = await runFilesystemStep(
         () => mkdir(destinationPath, { recursive: true }),
         'filesystem.operation.copy-failed',
         destinationPath
      );
      if (Result.isError(mkdirResult)) return Result.err<void, FilesystemProblem>(mkdirResult.error);

      const entries = await runFilesystemStep(() => readdir(sourcePath, { withFileTypes: true }), 'filesystem.operation.copy-failed', sourcePath);
      if (Result.isError(entries)) return Result.err<void, FilesystemProblem>(entries.error);

      for (const entry of entries.value) {
         const childResult = await copyNode(join(sourcePath, entry.name), join(destinationPath, entry.name), state);
         if (Result.isError(childResult)) return childResult;
      }

      return Result.ok<void, FilesystemProblem>(undefined);
   }

   if (sourceInfo.value.kind === 'link') {
      const target = await runFilesystemStep(() => readlink(sourcePath), 'filesystem.operation.copy-failed', sourcePath);
      if (Result.isError(target)) return Result.err<void, FilesystemProblem>(target.error);

      const linkResult = await runFilesystemStep(
         () => symlink(target.value, destinationPath, symlinkTypeForTarget(sourceInfo.value)),
         'filesystem.operation.copy-failed',
         destinationPath
      );
      if (Result.isError(linkResult)) return linkResult;

      state.files += 1;
      reportProgress(state, 'copying');
      return Result.ok<void, FilesystemProblem>(undefined);
   }

   if (sourceInfo.value.kind !== 'file') return Result.ok<void, FilesystemProblem>(undefined);

   const fileResult = await copyFileWithRetry(sourcePath, destinationPath, state.signal);
   if (Result.isError(fileResult)) return fileResult;

   state.bytes += sourceInfo.value.sizeBytes;
   state.files += 1;
   reportProgress(state, 'copying');

   return Result.ok<void, FilesystemProblem>(undefined);
}

async function copyFileWithRetry(sourcePath: string, destinationPath: string, signal?: AbortSignal): Promise<Result<void, FilesystemProblem>> {
   for (const delayMs of [0, ...copyRetryDelaysMs]) {
      if (delayMs > 0) await abortableSleep(delayMs, signal);

      const abort = getAbortProblem(signal);
      if (Result.isError(abort)) return abort;

      const copied = await Result.tryPromise({
         try: () => copyFile(sourcePath, destinationPath),
         catch: (cause) => cause
      });
      if (Result.isOk(copied)) return Result.ok<void, FilesystemProblem>(undefined);
      if (causeCode(copied.error) !== 'EBUSY' || delayMs === copyRetryDelaysMs.at(-1)) {
         return Result.err<void, FilesystemProblem>(
            createProblem('filesystem.operation.copy-failed', { path: destinationPath, cause: copied.error })
         );
      }
   }

   return Result.err<void, FilesystemProblem>(createProblem('filesystem.operation.copy-failed', { path: destinationPath }));
}

async function deleteNode(targetPath: string, state: WriteState): Promise<Result<void, FilesystemProblem>> {
   const abort = getAbortProblem(state.signal);
   if (Result.isError(abort)) return abort;

   const info = await readPathInfo(targetPath);
   if (Result.isError(info)) return Result.err<void, FilesystemProblem>(info.error);

   if (info.value.kind === 'directory') {
      const entries = await runFilesystemStep(() => readdir(targetPath, { withFileTypes: true }), 'filesystem.operation.delete-failed', targetPath);
      if (Result.isError(entries)) return Result.err<void, FilesystemProblem>(entries.error);

      for (const entry of entries.value) {
         const childResult = await deleteNode(join(targetPath, entry.name), state);
         if (Result.isError(childResult)) return childResult;
      }

      const removeDirectoryResult = await runFilesystemStep(
         () => rm(targetPath, { recursive: true, maxRetries: 5, retryDelay: 100 }),
         'filesystem.operation.delete-failed',
         targetPath
      );
      if (Result.isError(removeDirectoryResult)) return removeDirectoryResult;

      return Result.ok<void, FilesystemProblem>(undefined);
   }

   const unlinkResult = await runFilesystemStep(() => unlink(targetPath), 'filesystem.operation.delete-failed', targetPath);
   if (Result.isError(unlinkResult)) return unlinkResult;

   state.bytes += info.value.kind === 'file' ? info.value.sizeBytes : 0;
   state.files += 1;
   reportProgress(state, 'deleting');

   return Result.ok<void, FilesystemProblem>(undefined);
}

function createProgressReporter(options: FilesystemWriteOptions, phase: string, progressOptions: { keepComplete?: boolean } = {}): ProgressReporter {
   const report = throttleReports(options.onProgress);

   return (progress) => {
      const nextProgress: OperationProgress = { ...progress, phase };
      if (progressOptions.keepComplete) {
         nextProgress.current = progress.total;
         nextProgress.percent = 100;
      }

      report(nextProgress, (progress.percent ?? 0) >= 100);
   };
}

function reportProgress(state: WriteState, phase: string) {
   state.report(bytesProgress(phase, state.bytes, state.totalBytes, `${state.files}/${state.totalFiles} files`));
}

function getAbortProblem(signal?: AbortSignal): Result<void, FilesystemProblem> {
   if (!signal?.aborted) return Result.ok<void, FilesystemProblem>(undefined);

   return Result.err<void, FilesystemProblem>(createProblem('filesystem.operation.cancelled'));
}

async function runFilesystemStep<T>(
   task: () => Promise<T>,
   code: FilesystemProblem['code'],
   targetPath: string
): Promise<Result<T, FilesystemProblem>> {
   return Result.tryPromise({
      try: task,
      catch: (cause) => createProblem(code, { path: targetPath, cause })
   });
}
