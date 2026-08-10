import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';
import {
   createFilesystemProblem,
   createTempPath,
   isSamePath,
   resolveFilesystemPath,
   readPathInfo,
   type FilesystemProblem
} from '@/lib/filesystem/path';
import type { SharedFolderLinkState, SharedLinkMode, SharedLinkSupport } from '@/modules/shared-content/contract';

import { lstat, mkdir, rm, rmdir, symlink, unlink } from 'node:fs/promises';

export type FolderLinkInfo = {
   state: SharedFolderLinkState;
   linkTargetPath: string | null;
};

type LinkResult = Result<void, FilesystemProblem>;

export function preferredLinkMode(platform: NodeJS.Platform, useSymlinks: boolean): SharedLinkMode {
   if (platform !== 'win32') return 'symlink';

   return useSymlinks ? 'symlink' : 'junction';
}

export async function readFolderLink(folderPath: string, sharedFolderPath: string): Promise<FolderLinkInfo> {
   const info = await readPathInfo(folderPath);
   if (Result.isError(info)) return { state: info.error.detail === 'ENOENT' ? 'absent' : 'blocked', linkTargetPath: null };

   if (!info.value.isLink) return { state: info.value.kind === 'directory' ? 'unlinked' : 'blocked', linkTargetPath: null };

   const targetPath = info.value.targetPath;
   const linkTargetPath = targetPath ? (targetPath.startsWith('\\\\?\\') ? targetPath.slice(4) : targetPath) : null;
   if (!info.value.targetKind) return { state: 'broken', linkTargetPath };
   if (!linkTargetPath || !isSamePath(linkTargetPath, sharedFolderPath)) return { state: 'foreign', linkTargetPath };

   return { state: 'linked', linkTargetPath };
}

export async function createFolderLink(sharedFolderPath: string, folderPath: string, mode: SharedLinkMode): Promise<LinkResult> {
   return Result.tryPromise({
      try: () => symlink(resolveFilesystemPath(sharedFolderPath), resolveFilesystemPath(folderPath), mode === 'junction' ? 'junction' : 'dir'),
      catch: (cause) => createFilesystemProblem('filesystem.operation.copy-failed', 'failed to create the folder link', folderPath, cause)
   });
}

export async function removeFolderLink(folderPath: string): Promise<LinkResult> {
   const removed = await Result.tryPromise({
      try: () => unlink(resolveFilesystemPath(folderPath)),
      catch: (cause) => cause
   });
   if (Result.isOk(removed)) return Result.ok<void, FilesystemProblem>(undefined);

   // Windows junctions require rmdir; it removes the junction itself, not its target
   return Result.tryPromise({
      try: () => rmdir(resolveFilesystemPath(folderPath)),
      catch: (cause) => createFilesystemProblem('filesystem.operation.delete-failed', 'failed to remove the folder link', folderPath, cause)
   });
}

export async function probeLinkSupport(rootPath: string, requestedMode: SharedLinkMode): Promise<SharedLinkSupport> {
   const attempts: SharedLinkMode[] = requestedMode === 'symlink' && process.platform === 'win32' ? ['symlink', 'junction'] : [requestedMode];
   let detail: string | null = null;

   const prepared = await Result.tryPromise({
      try: () => mkdir(resolveFilesystemPath(rootPath), { recursive: true }),
      catch: (cause) => createFilesystemProblem('filesystem.operation.copy-failed', 'failed to create the shared content folder', rootPath, cause)
   });
   if (Result.isError(prepared)) return { supported: false, mode: requestedMode, requestedMode, detail: prepared.error.detail ?? null };

   for (const mode of attempts) {
      const attempted = await attemptLink(rootPath, mode);
      if (Result.isOk(attempted)) return { supported: true, mode, requestedMode, detail: null };

      detail ??= attempted.error;
   }

   return { supported: false, mode: requestedMode, requestedMode, detail };
}

async function attemptLink(rootPath: string, mode: SharedLinkMode): Promise<Result<void, string>> {
   const probePath = createTempPath({ parentPath: rootPath, prefix: 'encore-link-probe', suffix: '' });
   const linkPath = `${probePath}-link`;

   const linked = await Result.tryPromise({
      try: async () => {
         await mkdir(probePath, { recursive: true });
         await symlink(probePath, linkPath, mode === 'junction' ? 'junction' : 'dir');

         return lstat(linkPath);
      },
      catch: causeCode
   });

   await removeFolderLink(linkPath);
   await rm(probePath, { recursive: true, force: true }).catch(() => undefined);

   return Result.andThen(linked, (stats) =>
      stats.isSymbolicLink() ? Result.ok<void, string>(undefined) : Result.err<void, string>('the link was not created as a link')
   );
}
