import { Result } from 'better-result';
import { buf as crc32 } from 'crc-32';

import { openZipArchive, type ZipArchive } from '@/lib/archive/zip-read';
import type { ArchiveInspection, InspectedArchiveEntry } from '@/lib/content/archive-inspection';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import type { ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { isPathInside, removeQuietly, resolveFilesystemPath } from '@/lib/filesystem/path';
import { bytesProgress, throttleReports } from '@/lib/progress';
import type { OperationProgress } from '@/modules/operations/contract';

import { mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type ExtractArchiveOptions = {
   inspection: ArchiveInspection;
   destinationPath: string;
   limits?: Partial<ContentLimits>;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

type ArchiveExtraction = {
   path: string;
   files: number;
   directories: number;
   bytes: number;
};

export async function extractZipArchive(options: ExtractArchiveOptions): Promise<Result<ArchiveExtraction, ContentProblem>> {
   const limits = resolveContentLimits(options.limits);
   const destinationPath = resolveFilesystemPath(options.destinationPath);

   const prepared = await prepareDestination(destinationPath);
   if (Result.isError(prepared)) return Result.err<ArchiveExtraction, ContentProblem>(prepared.error);

   const archive = await openZipArchive(options.inspection.archivePath, { maxEntries: limits.maxEntries });
   if (Result.isError(archive)) {
      await removeQuietly(destinationPath);
      return Result.err<ArchiveExtraction, ContentProblem>(archive.error);
   }

   const extraction = await Result.tryPromise({
      try: () => writeEntries({ ...options, limits, destinationPath }, archive.value),
      catch: (cause): ContentProblem => createProblem('content.extract.write-failed', { path: destinationPath, cause })
   });
   archive.value.close();

   const result = Result.flatten(extraction);
   if (Result.isError(result)) await removeQuietly(destinationPath);

   return result;
}

async function writeEntries(
   options: ExtractArchiveOptions & { limits: ContentLimits; destinationPath: string },
   archive: ZipArchive
): Promise<Result<ArchiveExtraction, ContentProblem>> {
   const report = throttleReports(options.onProgress);
   const totalBytes = options.inspection.manifest.totalBytes;
   const totalFiles = options.inspection.manifest.fileCount;
   let bytes = 0;
   let files = 0;
   let directories = 0;

   for (const entry of options.inspection.entries) {
      if (options.signal?.aborted) return Result.err<ArchiveExtraction, ContentProblem>(createProblem('content.extract.cancelled'));

      const target = resolveEntryPath(options.destinationPath, entry);
      if (Result.isError(target)) return Result.err<ArchiveExtraction, ContentProblem>(target.error);

      if (entry.kind === 'directory') {
         const created = await createDirectory(target.value);
         if (Result.isError(created)) return Result.err<ArchiveExtraction, ContentProblem>(created.error);

         directories += 1;
         continue;
      }

      const parent = await createDirectory(dirname(target.value));
      if (Result.isError(parent)) return Result.err<ArchiveExtraction, ContentProblem>(parent.error);

      const written = await writeEntryFile({ ...options, entry, targetPath: target.value, archive });
      if (Result.isError(written)) return Result.err<ArchiveExtraction, ContentProblem>(written.error);

      bytes += written.value;
      files += 1;
      report(bytesProgress('extracting', bytes, totalBytes, `${files}/${totalFiles} files`));
   }

   report({ ...bytesProgress('extracting', bytes, totalBytes, `${files}/${totalFiles} files`), percent: 100 }, true);

   return Result.ok<ArchiveExtraction, ContentProblem>({ path: options.destinationPath, files, directories, bytes });
}

async function writeEntryFile(
   options: ExtractArchiveOptions & {
      limits: ContentLimits;
      destinationPath: string;
      entry: InspectedArchiveEntry;
      targetPath: string;
      archive: ZipArchive;
   }
): Promise<Result<number, ContentProblem>> {
   const source = await options.archive.openEntryStream(options.entry.record);
   if (Result.isError(source)) return Result.err<number, ContentProblem>(source.error);

   const file = await Result.tryPromise({
      try: () => open(options.targetPath, 'wx'),
      catch: (cause): ContentProblem =>
         createProblem('content.extract.entry-write-failed', { entry: options.entry.path, path: options.targetPath, cause })
   });
   if (Result.isError(file)) {
      source.value.destroy();
      return Result.err<number, ContentProblem>(file.error);
   }

   const declaredBytes = options.entry.record.uncompressedBytes;
   let bytes = 0;
   let checksum = 0;

   const streamed = await Result.tryPromise({
      try: async () => {
         for await (const chunk of source.value) {
            if (options.signal?.aborted) return Result.err<void, ContentProblem>(createProblem('content.extract.cancelled'));
            if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected binary chunk');

            bytes += chunk.byteLength;
            if (bytes > declaredBytes || bytes > options.limits.maxEntryBytes) {
               return Result.err<void, ContentProblem>(createProblem('content.extract.size-mismatch', { entry: options.entry.path }));
            }

            checksum = crc32(chunk, checksum);
            await file.value.write(chunk);
         }

         return Result.ok<void, ContentProblem>(undefined);
      },
      catch: (cause): ContentProblem => createProblem('content.archive.entry-corrupt', { entry: options.entry.path, cause })
   });
   source.value.destroy();
   await file.value.close();

   return Result.flatten(streamed).andThen(() => {
      if (bytes !== declaredBytes) {
         return Result.err<number, ContentProblem>(createProblem('content.extract.size-mismatch', { entry: options.entry.path }));
      }
      if (checksum >>> 0 !== options.entry.record.crc32) {
         return Result.err<number, ContentProblem>(createProblem('content.extract.checksum-mismatch', { entry: options.entry.path }));
      }

      return Result.ok<number, ContentProblem>(bytes);
   });
}

function resolveEntryPath(destinationPath: string, entry: InspectedArchiveEntry): Result<string, ContentProblem> {
   // archive paths are rechecked at the write boundary so no entry can escape staging
   const targetPath = resolveFilesystemPath(join(destinationPath, ...entry.path.split('/')));

   if (!isPathInside(destinationPath, targetPath)) {
      return Result.err<string, ContentProblem>(createProblem('content.extract.escaped-root', { entry: entry.path, path: targetPath }));
   }

   return Result.ok<string, ContentProblem>(targetPath);
}

async function prepareDestination(destinationPath: string): Promise<Result<void, ContentProblem>> {
   const created = await Result.tryPromise({
      try: async () => {
         await mkdir(destinationPath, { recursive: true });
         return readdir(destinationPath);
      },
      catch: (cause): ContentProblem => createProblem('content.extract.staging-failed', { path: destinationPath, cause })
   });
   if (Result.isError(created)) return Result.err<void, ContentProblem>(created.error);

   if (created.value.length > 0) {
      return Result.err<void, ContentProblem>(createProblem('content.extract.destination-not-empty', { path: destinationPath }));
   }

   return Result.ok<void, ContentProblem>(undefined);
}

async function createDirectory(directoryPath: string): Promise<Result<void, ContentProblem>> {
   const created = await Result.tryPromise({
      try: () => mkdir(directoryPath, { recursive: true }),
      catch: (cause): ContentProblem => createProblem('content.extract.folder-failed', { path: directoryPath, cause })
   });

   return Result.isError(created) ? Result.err<void, ContentProblem>(created.error) : Result.ok<void, ContentProblem>(undefined);
}
