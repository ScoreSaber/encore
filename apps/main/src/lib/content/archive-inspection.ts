import { Result } from 'better-result';

import { parseArchiveEntryPath } from '@/lib/archive/path';
import {
   isZipDirectoryMode,
   openZipArchive,
   unsupportedZipEntryKind,
   zipCompressionDeflate,
   zipCompressionStored,
   type ZipEntryRecord
} from '@/lib/archive/zip-read';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import type { ArchiveEntry, ArchiveManifest, ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';

export type InspectedArchiveEntry = ArchiveEntry & {
   record: ZipEntryRecord;
};

export type ArchiveInspection = {
   archivePath: string;
   archiveBytes: number;
   manifest: ArchiveManifest;
   entries: InspectedArchiveEntry[];
};

type InspectArchiveOptions = {
   archivePath: string;
   limits?: Partial<ContentLimits>;
};

type InspectArchiveRecordsInput = {
   archivePath: string;
   archiveBytes: number;
   records: readonly ZipEntryRecord[];
   limits: ContentLimits;
};

export async function inspectZipArchive(options: InspectArchiveOptions): Promise<Result<ArchiveInspection, ContentProblem>> {
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

function inspectArchiveRecords(input: InspectArchiveRecordsInput): Result<ArchiveInspection, ContentProblem> {
   const { limits } = input;

   if (input.archiveBytes > limits.maxArchiveBytes) {
      return Result.err<ArchiveInspection, ContentProblem>(
         createProblem('content.archive.too-large', { path: input.archivePath, detail: `${limits.maxArchiveBytes} bytes` })
      );
   }

   if (input.records.length === 0) {
      return Result.err<ArchiveInspection, ContentProblem>(createProblem('content.archive.empty', { path: input.archivePath }));
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
         return Result.err<ArchiveInspection, ContentProblem>(
            createProblem('content.archive.unpacked-too-large', { path: input.archivePath, detail: `${limits.maxTotalBytes} bytes` })
         );
      }

      entries.push(entry);
   }

   const ratio = compressedBytes > 0 ? totalBytes / compressedBytes : 0;
   if (compressedBytes >= limits.ratioFloorBytes && ratio > limits.maxCompressionRatio) {
      return Result.err<ArchiveInspection, ContentProblem>(
         createProblem('content.archive.ratio-exceeded', { path: input.archivePath, detail: `${Math.round(ratio)}:1` })
      );
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

function inspectEntry(record: ZipEntryRecord, limits: ContentLimits): Result<InspectedArchiveEntry, ContentProblem> {
   const entry = record.name;
   if (record.encrypted) return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.encrypted', { entry }));

   const unsupportedKind = unsupportedZipEntryKind(record);
   if (unsupportedKind) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.unsupported-entry', { kind: unsupportedKind, entry }));
   }

   const parsed = parseArchiveEntryPath(record.name);
   if (Result.isError(parsed)) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.path-rejected', { reason: parsed.error, entry }));
   }

   if (parsed.value.path.length > limits.maxPathLength || parsed.value.segments.length > limits.maxPathDepth) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.path-too-long', { entry }));
   }

   if (record.compressionMethod !== zipCompressionStored && record.compressionMethod !== zipCompressionDeflate) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.unsupported-compression', { entry }));
   }

   const isDirectory = parsed.value.endsWithSeparator || isZipDirectoryMode(record.unixMode);

   if (!isDirectory && record.uncompressedBytes > limits.maxEntryBytes) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.entry-too-large', { entry }));
   }

   if (
      !isDirectory &&
      record.compressedBytes >= limits.ratioFloorBytes &&
      record.uncompressedBytes / record.compressedBytes > limits.maxCompressionRatio
   ) {
      return Result.err<InspectedArchiveEntry, ContentProblem>(createProblem('content.archive.entry-ratio-exceeded', { entry }));
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
   const key = entry.path.toLowerCase();
   const claimed = kinds.get(key);
   if (claimed && (claimed !== entry.kind || entry.kind === 'file')) {
      return createProblem('content.archive.duplicate-entry', { entry: entry.path });
   }

   const segments = entry.path.split('/');
   for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestorKey = segments.slice(0, depth).join('/').toLowerCase();
      if (kinds.get(ancestorKey) === 'file') {
         return createProblem('content.archive.path-clash', { entry: entry.path });
      }

      kinds.set(ancestorKey, 'directory');
   }

   kinds.set(key, entry.kind);
   return null;
}
