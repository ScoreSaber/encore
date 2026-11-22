import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { isSamePath, resolveFilesystemPath } from '@/lib/filesystem/path';
import type { InstallRootIssue, InstallRootValidation } from '@/modules/installs/contract';
import { beatSaberDataDirectoryName } from '@/modules/installs/main/beat-saber-files';

import { constants } from 'node:fs';
import { access, lstat, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, win32 } from 'node:path';

const defaultLibraryDirectoryName = 'library';

export function createDefaultInstallRoot(options: { platform: NodeJS.Platform; userDataPath: string }) {
   const path = options.platform === 'win32' ? win32 : posix;
   return path.join(options.userDataPath, defaultLibraryDirectoryName);
}

export async function countInstallDirectories(installRoot: string) {
   const root = resolveFilesystemPath(installRoot);
   const entries = await Result.tryPromise({
      try: () => readdir(root, { withFileTypes: true }),
      catch: () => null
   });
   if (Result.isError(entries)) return 0;

   const directories = entries.value.filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name));
   const flags = await Promise.all(directories.map(looksLikeInstall));

   return flags.filter(Boolean).length;
}

export async function validateInstallRoot(options: { path: string; currentRoot: string }): Promise<InstallRootValidation> {
   const trimmed = options.path.trim();
   if (!trimmed) return invalidRoot(trimmed, 'empty');
   if (!isAbsolute(trimmed)) return invalidRoot(trimmed, 'not-absolute');

   const path = resolveFilesystemPath(trimmed);
   if (isSamePath(path, options.currentRoot)) return { ...invalidRoot(path, 'unchanged'), exists: true };

   const stats = await Result.tryPromise({
      try: () => lstat(path),
      catch: (cause) => createProblem('filesystem.path.inspect-failed', { path, cause })
   });

   if (Result.isError(stats)) {
      if (stats.error.detail !== 'ENOENT') return invalidRoot(path, 'inspect-failed');
      if (!(await isWritableDirectory(dirname(path)))) return invalidRoot(path, 'parent-missing');

      return { path, status: 'ok', exists: false, installCount: 0 };
   }

   if (!stats.value.isDirectory()) return { ...invalidRoot(path, 'not-a-directory'), exists: true };
   if (!(await isWritableDirectory(path))) return { ...invalidRoot(path, 'not-writable'), exists: true };

   return {
      path,
      status: 'ok',
      exists: true,
      installCount: await countInstallDirectories(path)
   };
}

async function looksLikeInstall(installPath: string) {
   const markPath = join(installPath, beatSaberDataDirectoryName);
   const stats = await Result.tryPromise({ try: () => lstat(markPath), catch: () => null });

   return Result.isOk(stats);
}

async function isWritableDirectory(directoryPath: string) {
   const allowed = await Result.tryPromise({ try: () => access(directoryPath, constants.W_OK | constants.X_OK), catch: () => null });

   return Result.isOk(allowed);
}

function invalidRoot(path: string, issue: InstallRootIssue): InstallRootValidation {
   return { path, status: 'invalid', exists: false, installCount: 0, issue };
}
