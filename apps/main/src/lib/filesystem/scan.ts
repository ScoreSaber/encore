import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { resolveFilesystemPath, type FilesystemProblem } from '@/lib/filesystem/path';
import { throttleReports } from '@/lib/progress';

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const defaultBatchSize = 16;

type ScanBatchOptions = {
   batchSize?: number;
   signal?: AbortSignal;
   onProgress?: (progress: { scanned: number; total: number }) => void;
};

export async function scanInBatches<Entry, Row>(entries: Entry[], options: ScanBatchOptions, read: (entry: Entry) => Promise<Row>) {
   const rows: Row[] = [];
   const report = throttleReports(options.onProgress);
   const batchSize = options.batchSize ?? defaultBatchSize;

   for (let index = 0; index < entries.length; index += batchSize) {
      if (options.signal?.aborted) break;

      rows.push(...(await Promise.all(entries.slice(index, index + batchSize).map(read))));
      report({ scanned: rows.length, total: entries.length }, rows.length === entries.length);
   }

   return rows;
}

type DirectorySize = {
   bytes: number;
   files: number;
};

export function getDirectorySize(targetPath: string) {
   return readSize(resolveFilesystemPath(targetPath));
}

async function readSize(targetPath: string): Promise<Result<DirectorySize, FilesystemProblem>> {
   const stats = await Result.tryPromise({
      try: () => lstat(targetPath),
      catch: (cause) => createProblem('filesystem.size.failed', { path: targetPath, cause })
   });
   if (Result.isError(stats)) return Result.err<DirectorySize, FilesystemProblem>(stats.error);

   if (stats.value.isFile()) return Result.ok<DirectorySize, FilesystemProblem>({ bytes: stats.value.size, files: 1 });
   if (!stats.value.isDirectory()) return Result.ok<DirectorySize, FilesystemProblem>({ bytes: 0, files: 1 });

   const size: DirectorySize = { bytes: 0, files: 0 };
   const entries = await Result.tryPromise({
      try: () => readdir(targetPath, { withFileTypes: true }),
      catch: (cause) => createProblem('filesystem.size.failed', { path: targetPath, cause })
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
   }

   return Result.ok<DirectorySize, FilesystemProblem>(size);
}
