import { Result } from 'better-result';
import { buf as crc32 } from 'crc-32';
import { z } from 'zod';

import type { ArchiveInspection, InspectedArchiveEntry } from '@/lib/content/archive-inspection';
import type { ContentResult } from '@/lib/content/content-errors';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import type { ContentProblem } from '@/lib/content/contract';
import { openZipArchive, type ZipArchive } from '@/lib/content/zip-archive';
import { isPathInside, resolveFilesystemPath } from '@/lib/filesystem/path';
import type { OperationProgress } from '@/modules/operations/contract';
import { createThrottledProgress } from '@/modules/operations/main/progress';

import { mkdir, open, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type ExtractArchiveOptions = {
   inspection: ArchiveInspection;
   destinationPath: string;
   limits?: Partial<ContentLimits>;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export type ArchiveExtraction = {
   path: string;
   files: number;
   directories: number;
   bytes: number;
};

export async function extractZipArchive(options: ExtractArchiveOptions): Promise<ContentResult<ArchiveExtraction>> {
   const limits = resolveContentLimits(options.limits);
   const destinationPath = resolveFilesystemPath(options.destinationPath);

   const prepared = await prepareDestination(destinationPath);
   if (Result.isError(prepared)) return Result.err<ArchiveExtraction, ContentProblem>(prepared.error);

   const archive = await openZipArchive(options.inspection.archivePath, { maxEntries: limits.maxEntries });
   if (Result.isError(archive)) {
      await discardPath(destinationPath);
      return Result.err<ArchiveExtraction, ContentProblem>(archive.error);
   }

   const extraction = await Result.tryPromise({
      try: () => writeEntries({ ...options, limits, destinationPath }, archive.value),
      catch: (cause): ContentProblem => ({
         code: 'content.extract.write-failed',
         message: 'the archive could not be unpacked',
         path: destinationPath,
         detail: String(cause)
      })
   });
   archive.value.close();

   const result = Result.isOk(extraction) ? extraction.value : Result.err<ArchiveExtraction, ContentProblem>(extraction.error);
   if (Result.isError(result)) await discardPath(destinationPath);

   return result;
}

async function writeEntries(
   options: ExtractArchiveOptions & { limits: ContentLimits; destinationPath: string },
   archive: ZipArchive
): Promise<ContentResult<ArchiveExtraction>> {
   const report = createThrottledProgress(options.onProgress);
   const totalBytes = options.inspection.manifest.totalBytes;
   const totalFiles = options.inspection.manifest.fileCount;
   let bytes = 0;
   let files = 0;
   let directories = 0;

   for (const entry of options.inspection.entries) {
      if (options.signal?.aborted) return Result.err<ArchiveExtraction, ContentProblem>(cancelled());

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
      report({
         phase: 'extracting',
         current: bytes,
         total: totalBytes,
         percent: totalBytes > 0 ? Math.min(100, Math.round((bytes / totalBytes) * 100)) : 100,
         unit: 'bytes',
         label: `${files}/${totalFiles} files`
      });
   }

   report(
      { phase: 'extracting', current: bytes, total: totalBytes, percent: 100, unit: 'bytes', label: `${files}/${totalFiles} files` },
      { force: true }
   );

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
): Promise<ContentResult<number>> {
   const source = await options.archive.openEntryStream(options.entry.record);
   if (Result.isError(source)) return Result.err<number, ContentProblem>(source.error);

   const file = await Result.tryPromise({
      try: () => open(options.targetPath, 'wx'),
      catch: (cause): ContentProblem => ({
         code: 'content.extract.write-failed',
         message: 'an archive entry could not be written',
         entry: options.entry.path,
         path: options.targetPath,
         detail: String(cause)
      })
   });
   if (Result.isError(file)) {
      source.value.destroy();
      return Result.err<number, ContentProblem>(file.error);
   }

   const declaredBytes = options.entry.record.uncompressedBytes;
   let bytes = 0;
   let checksum = 0;
   let failure: ContentProblem | null = null;

   try {
      for await (const chunk of source.value) {
         if (options.signal?.aborted) {
            failure = cancelled();
            break;
         }

         const payload = z.instanceof(Uint8Array).parse(chunk);
         bytes += payload.byteLength;
         if (bytes > declaredBytes || bytes > options.limits.maxEntryBytes) {
            failure = sizeMismatch(options.entry.path);
            break;
         }

         checksum = crc32(payload, checksum);
         await file.value.write(payload);
      }
   } catch (cause) {
      failure = {
         code: 'content.archive.corrupt',
         message: 'an archive entry could not be unpacked',
         entry: options.entry.path,
         detail: String(cause)
      };
   } finally {
      source.value.destroy();
      await file.value.close();
   }

   if (!failure && bytes !== declaredBytes) failure = sizeMismatch(options.entry.path);
   if (!failure && checksum >>> 0 !== options.entry.record.crc32) {
      failure = {
         code: 'content.extract.checksum-mismatch',
         message: 'an archive entry did not match its checksum',
         entry: options.entry.path
      };
   }

   return failure ? Result.err<number, ContentProblem>(failure) : Result.ok<number, ContentProblem>(bytes);
}

function resolveEntryPath(destinationPath: string, entry: InspectedArchiveEntry): ContentResult<string> {
   // archive paths are rechecked at the write boundary so no entry can escape staging
   const targetPath = resolveFilesystemPath(join(destinationPath, ...entry.path.split('/')));

   if (!isPathInside(destinationPath, targetPath)) {
      return Result.err<string, ContentProblem>({
         code: 'content.extract.escaped-root',
         message: 'an archive entry tried to write outside the staging folder',
         entry: entry.path,
         path: targetPath
      });
   }

   return Result.ok<string, ContentProblem>(targetPath);
}

async function prepareDestination(destinationPath: string): Promise<ContentResult<void>> {
   const created = await Result.tryPromise({
      try: async () => {
         await mkdir(destinationPath, { recursive: true });
         return readdir(destinationPath);
      },
      catch: (cause): ContentProblem => ({
         code: 'content.extract.write-failed',
         message: 'the staging folder for the archive could not be created',
         path: destinationPath,
         detail: String(cause)
      })
   });
   if (Result.isError(created)) return Result.err<void, ContentProblem>(created.error);

   if (created.value.length > 0) {
      return Result.err<void, ContentProblem>({
         code: 'content.extract.destination-not-empty',
         message: 'archives only unpack into an empty staging folder',
         path: destinationPath
      });
   }

   return Result.ok<void, ContentProblem>(undefined);
}

async function createDirectory(directoryPath: string): Promise<ContentResult<void>> {
   const created = await Result.tryPromise({
      try: () => mkdir(directoryPath, { recursive: true }),
      catch: (cause): ContentProblem => ({
         code: 'content.extract.write-failed',
         message: 'an archive folder could not be created',
         path: directoryPath,
         detail: String(cause)
      })
   });

   return Result.isError(created) ? Result.err<void, ContentProblem>(created.error) : Result.ok<void, ContentProblem>(undefined);
}

async function discardPath(targetPath: string) {
   await Result.tryPromise({
      try: () => rm(targetPath, { recursive: true, force: true }),
      catch: (cause) => String(cause)
   });
}

function cancelled(): ContentProblem {
   return { code: 'content.extract.cancelled', message: 'unpacking was cancelled' };
}

function sizeMismatch(entryPath: string): ContentProblem {
   return {
      code: 'content.extract.size-mismatch',
      message: 'an archive entry unpacked to a different size than it declared',
      entry: entryPath
   };
}
