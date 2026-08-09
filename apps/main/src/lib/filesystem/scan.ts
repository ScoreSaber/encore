import { Result, type Err, type Ok } from 'better-result';

import { createFilesystemProblem, resolveFilesystemPath, type FilesystemProblem } from '@/lib/filesystem/path';

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const defaultBatchSize = 16;
const progressThrottleMs = 150;

type ScanBatchOptions = {
   batchSize?: number;
   signal?: AbortSignal;
   onProgress?: (progress: { scanned: number; total: number }) => void;
};

export async function scanInBatches<Entry, Row>(entries: Entry[], options: ScanBatchOptions, read: (entry: Entry) => Promise<Row>) {
   const rows: Row[] = [];
   let lastProgressAt = 0;
   const batchSize = options.batchSize ?? defaultBatchSize;

   for (let index = 0; index < entries.length; index += batchSize) {
      if (options.signal?.aborted) break;

      rows.push(...(await Promise.all(entries.slice(index, index + batchSize).map(read))));

      const now = Date.now();
      if (rows.length === entries.length || now - lastProgressAt >= progressThrottleMs) {
         lastProgressAt = now;
         options.onProgress?.({ scanned: rows.length, total: entries.length });
      }
   }

   return rows;
}

export type DirectorySize = {
   bytes: number;
   files: number;
   directories: number;
   links: number;
   skipped: number;
};

type DirectorySizeResult = Ok<DirectorySize, FilesystemProblem> | Err<DirectorySize, FilesystemProblem>;

export async function getDirectorySize(targetPath: string): Promise<DirectorySizeResult> {
   const normalizedPath = resolveFilesystemPath(targetPath);

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

   const leaves = entries.value.filter((entry) => !entry.isDirectory());
   const leafSizes = await scanInBatches(leaves, {}, (entry) => readSize(join(targetPath, entry.name)));
   const sizeByName = new Map(leaves.map((entry, offset) => [entry.name, leafSizes[offset]]));

   for (const entry of entries.value) {
      const entrySize = sizeByName.get(entry.name) ?? (await readSize(join(targetPath, entry.name)));

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
