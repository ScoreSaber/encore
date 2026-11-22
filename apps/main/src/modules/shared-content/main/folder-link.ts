import { Result } from 'better-result';

import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { createTempPath, isSamePath, resolveFilesystemPath, readPathInfo, removeQuietly } from '@/lib/filesystem/path';
import type { SharedFolderLinkState, SharedLinkMode, SharedLinkSupport } from '@/modules/shared-content/contract';

import { lstat, mkdir, rmdir, symlink, unlink } from 'node:fs/promises';

type FolderLinkInfo = {
   state: SharedFolderLinkState;
   linkTargetPath: string | null;
};

type LinkResult = Result<void, Problem & { path: string }>;

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
      catch: (cause) => createProblem('shared.link.create-failed', { path: folderPath, cause })
   });
}

export async function removeFolderLink(folderPath: string): Promise<LinkResult> {
   const removed = await Result.tryPromise({
      try: () => unlink(resolveFilesystemPath(folderPath)),
      catch: (cause) => cause
   });
   if (Result.isOk(removed)) return Result.ok<void, Problem & { path: string }>(undefined);

   // Windows junctions require rmdir; it removes the junction itself, not its target
   return Result.tryPromise({
      try: () => rmdir(resolveFilesystemPath(folderPath)),
      catch: (cause) => createProblem('shared.link.remove-failed', { path: folderPath, cause })
   });
}

export async function probeLinkSupport(rootPath: string, requestedMode: SharedLinkMode): Promise<SharedLinkSupport> {
   const attempts: SharedLinkMode[] = requestedMode === 'symlink' && process.platform === 'win32' ? ['symlink', 'junction'] : [requestedMode];
   let detail: string | null = null;

   const prepared = await Result.tryPromise({
      try: () => mkdir(resolveFilesystemPath(rootPath), { recursive: true }),
      catch: causeCode
   });
   if (Result.isError(prepared)) return { supported: false, mode: requestedMode, requestedMode, detail: prepared.error };

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
   await removeQuietly(probePath);

   return Result.andThen(linked, (stats) => (stats.isSymbolicLink() ? Result.ok<void, string>(undefined) : Result.err<void, string>('not-a-link')));
}
