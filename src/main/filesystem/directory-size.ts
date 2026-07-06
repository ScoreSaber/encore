import { Result, type Err, type Ok } from 'better-result';

import { createFilesystemProblem, normalizeFilesystemPath, type FilesystemProblem } from '@/main/filesystem/path-helpers';

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export type DirectorySize = {
   bytes: number;
   files: number;
   directories: number;
   links: number;
   skipped: number;
};

type DirectorySizeResult = Ok<DirectorySize, FilesystemProblem> | Err<DirectorySize, FilesystemProblem>;

export async function getDirectorySize(targetPath: string): Promise<DirectorySizeResult> {
   const normalizedPath = normalizeFilesystemPath(targetPath);

   return readSize(normalizedPath);
}

function emptySize(): DirectorySize {
   return {
      bytes: 0,
      files: 0,
      directories: 0,
      links: 0,
      skipped: 0
   };
}

async function readSize(targetPath: string): Promise<DirectorySizeResult> {
   const stats = await Result.tryPromise({
      try: () => lstat(targetPath),
      catch: (cause) => createFilesystemProblem('filesystem.size.failed', 'failed to calculate directory size', targetPath, cause)
   });
   if (Result.isError(stats)) return Result.err<DirectorySize, FilesystemProblem>(stats.error);

   if (stats.value.isSymbolicLink()) {
      return Result.ok<DirectorySize, FilesystemProblem>({
         ...emptySize(),
         files: 1,
         links: 1
      });
   }

   if (stats.value.isFile()) {
      return Result.ok<DirectorySize, FilesystemProblem>({
         ...emptySize(),
         bytes: stats.value.size,
         files: 1
      });
   }

   if (!stats.value.isDirectory()) {
      return Result.ok<DirectorySize, FilesystemProblem>({
         ...emptySize(),
         files: 1
      });
   }

   const size: DirectorySize = {
      ...emptySize(),
      directories: 1
   };
   const entries = await Result.tryPromise({
      try: () => readdir(targetPath, { withFileTypes: true }),
      catch: (cause) => createFilesystemProblem('filesystem.size.failed', 'failed to calculate directory size', targetPath, cause)
   });
   if (Result.isError(entries)) return Result.err<DirectorySize, FilesystemProblem>(entries.error);

   for (const entry of entries.value) {
      const entrySize = await readSize(join(targetPath, entry.name));
      if (Result.isError(entrySize)) {
         if (entrySize.error.detail === 'ENOENT') continue;
         return entrySize;
      }

      size.bytes += entrySize.value.bytes;
      size.files += entrySize.value.files;
      size.directories += entrySize.value.directories;
      size.links += entrySize.value.links;
      size.skipped += entrySize.value.skipped;
   }

   return Result.ok<DirectorySize, FilesystemProblem>(size);
}
