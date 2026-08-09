import { Result } from 'better-result';

import { archivePathKey, describeArchivePathRejection, parseArchiveEntryPath } from '@/lib/archive/path';
import type { ContentResult } from '@/lib/content/content-errors';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import type { ArchiveEntry, ArchiveManifest, ContentProblem } from '@/lib/content/contract';
import {
   describeUnsupportedZipEntry,
   isZipDirectoryMode,
   openZipArchive,
   zipCompressionDeflate,
   zipCompressionStored,
   type ZipEntryRecord
} from '@/lib/content/zip-archive';

export type InspectedArchiveEntry = ArchiveEntry & {
   record: ZipEntryRecord;
};

export type ArchiveInspection = {
   archivePath: string;
   archiveBytes: number;
   manifest: ArchiveManifest;
   entries: InspectedArchiveEntry[];
};

export type InspectArchiveOptions = {
   archivePath: string;
   limits?: Partial<ContentLimits>;
};

export type InspectArchiveRecordsInput = {
   archivePath: string;
   archiveBytes: number;
   records: readonly ZipEntryRecord[];
   limits: ContentLimits;
};

export async function inspectZipArchive(options: InspectArchiveOptions): Promise<ContentResult<ArchiveInspection>> {
   const limits = resolveContentLimits(options.limits);
   const archive = await openZipArchive(options.archivePath, { maxEntries: limits.maxEntries });
   if (Result.isError(archive)) return Result.err<ArchiveInspection, ContentProblem>(archive.error);

   try {
      return inspectArchiveRecords({
         archivePath: options.archivePath,
         archiveBytes: archive.value.archiveBytes,
         records: archive.value.records,
         limits
      });
   } finally {
      archive.value.close();
   }
}

export function inspectArchiveRecords(input: InspectArchiveRecordsInput): ContentResult<ArchiveInspection> {
   const { limits } = input;

   if (input.archiveBytes > limits.maxArchiveBytes) {
      return Result.err<ArchiveInspection, ContentProblem>({
         code: 'content.archive.too-large',
         message: 'the archive is larger than the allowed size',
         path: input.archivePath,
         detail: `${limits.maxArchiveBytes} bytes`
      });
   }

   if (input.records.length === 0) {
      return Result.err<ArchiveInspection, ContentProblem>({
         code: 'content.archive.corrupt',
         message: 'the archive holds no entries',
         path: input.archivePath
      });
   }

   const entries: InspectedArchiveEntry[] = [];
   const kinds = new Map<string, ArchiveEntry['kind']>();
   let totalBytes = 0;
   let compressedBytes = 0;

   for (const record of input.records) {
      const inspected = inspectEntry(record, limits);
      if (Result.isError(inspected)) return Result.err<ArchiveInspection, ContentProblem>(inspected.error);

      const entry = inspected.value;
      const conflict = claimPath(kinds, entry);
      if (conflict) return Result.err<ArchiveInspection, ContentProblem>(conflict);

      totalBytes += entry.sizeBytes;
      compressedBytes += entry.compressedBytes;

      if (totalBytes > limits.maxTotalBytes) {
         return Result.err<ArchiveInspection, ContentProblem>({
            code: 'content.archive.too-large',
            message: 'the archive expands to more than the allowed size',
            path: input.archivePath,
            detail: `${limits.maxTotalBytes} bytes`
         });
      }

      entries.push(entry);
   }

   const ratio = compressedBytes > 0 ? totalBytes / compressedBytes : 0;
   if (compressedBytes >= limits.ratioFloorBytes && ratio > limits.maxCompressionRatio) {
      return Result.err<ArchiveInspection, ContentProblem>({
         code: 'content.archive.ratio-exceeded',
         message: 'the archive expands far more than its size suggests',
         path: input.archivePath,
         detail: `${Math.round(ratio)}:1`
      });
   }

   return Result.ok<ArchiveInspection, ContentProblem>({
      archivePath: input.archivePath,
      archiveBytes: input.archiveBytes,
      entries,
      manifest: {
         format: 'zip',
         entries: entries.map(({ record: _record, ...entry }) => entry),
         fileCount: entries.filter((entry) => entry.kind === 'file').length,
         directoryCount: entries.filter((entry) => entry.kind === 'directory').length,
         totalBytes,
         compressedBytes,
         compressionRatio: Number(ratio.toFixed(2)),
         rootEntries: [...new Set(entries.map((entry) => entry.path.split('/')[0] ?? entry.path))].sort()
      }
   });
}

function inspectEntry(record: ZipEntryRecord, limits: ContentLimits): ContentResult<InspectedArchiveEntry> {
   if (record.encrypted) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(
         entryProblem('content.archive.encrypted', 'the archive is password protected', record)
      );
   }

   const unsupportedEntry = describeUnsupportedZipEntry(record);
   if (unsupportedEntry) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(entryProblem('content.archive.unsupported-entry', unsupportedEntry, record));
   }

   const parsed = parseArchiveEntryPath(record.name);
   if (Result.isError(parsed)) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(
         entryProblem('content.archive.path-rejected', describeArchivePathRejection(parsed.error), record)
      );
   }

   if (parsed.value.path.length > limits.maxPathLength || parsed.value.segments.length > limits.maxPathDepth) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(
         entryProblem('content.archive.path-too-long', 'an archive entry path is longer than allowed', record)
      );
   }

   if (record.compressionMethod !== zipCompressionStored && record.compressionMethod !== zipCompressionDeflate) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(
         entryProblem('content.archive.unsupported-compression', 'the archive uses a compression method Encore cannot read', record)
      );
   }

   const isDirectory = parsed.value.endsWithSeparator || isZipDirectoryMode(record.unixMode);

   if (!isDirectory && record.uncompressedBytes > limits.maxEntryBytes) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(
         entryProblem('content.archive.too-large', 'an archive entry is larger than allowed', record)
      );
   }

   if (
      !isDirectory &&
      record.compressedBytes >= limits.ratioFloorBytes &&
      record.uncompressedBytes / record.compressedBytes > limits.maxCompressionRatio
   ) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(
         entryProblem('content.archive.ratio-exceeded', 'an archive entry expands far more than its size suggests', record)
      );
   }

   return Result.ok<InspectedArchiveEntry, ContentProblem>({
      path: parsed.value.path,
      kind: isDirectory ? 'directory' : 'file',
      sizeBytes: isDirectory ? 0 : record.uncompressedBytes,
      compressedBytes: isDirectory ? 0 : record.compressedBytes,
      record
   });
}

function claimPath(kinds: Map<string, ArchiveEntry['kind']>, entry: InspectedArchiveEntry): ContentProblem | null {
   const key = archivePathKey(entry.path);
   const claimed = kinds.get(key);
   if (claimed && (claimed !== entry.kind || entry.kind === 'file')) {
      return {
         code: 'content.archive.duplicate-entry',
         message: 'the archive holds two entries that would write to the same path',
         entry: entry.path
      };
   }

   const segments = entry.path.split('/');
   for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestorKey = archivePathKey(segments.slice(0, depth).join('/'));
      if (kinds.get(ancestorKey) === 'file') {
         return {
            code: 'content.archive.duplicate-entry',
            message: 'the archive holds a folder and a file with the same path',
            entry: entry.path
         };
      }

      kinds.set(ancestorKey, 'directory');
   }

   kinds.set(key, entry.kind);
   return null;
}

function entryProblem(code: ContentProblem['code'], message: string, record: ZipEntryRecord): ContentProblem {
   return { code, message, entry: record.name };
}
