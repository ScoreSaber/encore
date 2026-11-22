import { Result } from 'better-result';
import { openPromise as openZipFile, type Entry, type ZipFile } from 'yauzl';

import type { ContentProblem } from '@/lib/content/contract';
import { causeMessage, createProblem } from '@/lib/errors';

import type { Readable } from 'node:stream';

export const zipCompressionStored = 0;
export const zipCompressionDeflate = 8;

const unixHostSystem = 3;
const msdosReparsePointAttribute = 0x400;
const unixFileTypeMask = 0xf000;
const unixDirectory = 0x4000;
const unixRegularFile = 0x8000;
const unixSymbolicLink = 0xa000;

export type ZipEntryRecord = {
   index: number;
   name: string;
   encrypted: boolean;
   compressionMethod: number;
   crc32: number;
   compressedBytes: number;
   uncompressedBytes: number;
   unixMode: number | null;
   reparsePoint: boolean;
};

export type ZipArchive = {
   archivePath: string;
   archiveBytes: number;
   records: ZipEntryRecord[];
   openEntryStream: (record: ZipEntryRecord) => Promise<Result<Readable, ContentProblem>>;
   close: () => void;
};

export async function openZipArchive(archivePath: string, options: { maxEntries: number }): Promise<Result<ZipArchive, ContentProblem>> {
   const opened = await Result.tryPromise({
      try: () => openZipFile(archivePath, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: false }),
      catch: (cause) => describeZipFailure(cause, archivePath)
   });
   if (Result.isError(opened)) return Result.err<ZipArchive, ContentProblem>(opened.error);

   const zipFile = opened.value;

   if (zipFile.entryCount > options.maxEntries) {
      zipFile.close();
      return Result.err<ZipArchive, ContentProblem>(
         createProblem('content.archive.too-many-entries', { path: archivePath, detail: `${options.maxEntries} entries` })
      );
   }

   const entries = await Result.tryPromise({
      try: async () => {
         const read: Entry[] = [];
         for await (const entry of zipFile.eachEntry()) read.push(entry);
         return read;
      },
      catch: (cause) => describeZipFailure(cause, archivePath)
   });
   if (Result.isError(entries)) {
      zipFile.close();
      return Result.err<ZipArchive, ContentProblem>(entries.error);
   }

   return Result.ok<ZipArchive, ContentProblem>({
      archivePath,
      archiveBytes: zipFile.fileSize,
      records: entries.value.map(toEntryRecord),
      openEntryStream: (record) => openEntryStream(zipFile, entries.value, record, archivePath),
      close: () => zipFile.close()
   });
}

export function isZipDirectoryMode(unixMode: number | null) {
   return unixMode !== null && (unixMode & unixFileTypeMask) === unixDirectory;
}

export function unsupportedZipEntryKind(record: ZipEntryRecord) {
   if (record.reparsePoint) return 'windowsLink';
   if (record.unixMode === null || record.unixMode === 0) return null;

   const fileType = record.unixMode & unixFileTypeMask;
   if (fileType === unixSymbolicLink) return 'symbolicLink';
   if (fileType === 0) return null;
   if (fileType !== unixDirectory && fileType !== unixRegularFile) return 'specialFile';

   return null;
}

async function openEntryStream(zipFile: ZipFile, entries: Entry[], record: ZipEntryRecord, archivePath: string) {
   const entry = entries[record.index];

   if (!entry || entry.fileName !== record.name) {
      return Result.err<Readable, ContentProblem>(createProblem('content.archive.changed', { entry: record.name, path: archivePath }));
   }

   return Result.tryPromise({
      try: () => zipFile.openReadStreamPromise(entry),
      catch: (cause) => describeZipFailure(cause, archivePath, record.name)
   });
}

function toEntryRecord(entry: Entry, index: number): ZipEntryRecord {
   const madeByUnix = entry.versionMadeBy >> 8 === unixHostSystem;

   return {
      index,
      name: entry.fileName,
      encrypted: entry.isEncrypted(),
      compressionMethod: entry.compressionMethod,
      crc32: entry.crc32 >>> 0,
      compressedBytes: entry.compressedSize,
      uncompressedBytes: entry.uncompressedSize,
      unixMode: madeByUnix ? (entry.externalFileAttributes >>> 16) & 0xffff : null,
      reparsePoint: !madeByUnix && (entry.externalFileAttributes & msdosReparsePointAttribute) !== 0
   };
}

function describeZipFailure(cause: unknown, archivePath: string, entryName?: string): ContentProblem {
   const message = causeMessage(cause);
   const rejectedPath = /^(?:absolute path|invalid relative path|invalid characters in fileName): (.+)$/.exec(message);

   if (rejectedPath?.[1]) return createProblem('content.archive.path-rejected', { reason: 'unsafe', entry: rejectedPath[1], path: archivePath });

   if (message.startsWith('End of central directory record signature not found')) {
      return createProblem('content.archive.not-zip', { path: archivePath });
   }

   if (cause instanceof Error && 'code' in cause) return createProblem('content.archive.read-failed', { path: archivePath, detail: message });

   return createProblem('content.archive.corrupt', { path: archivePath, entry: entryName, detail: message });
}
