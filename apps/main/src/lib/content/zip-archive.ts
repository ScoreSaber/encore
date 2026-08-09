import { Result } from 'better-result';
import { open as openZipFile, type Entry, type ZipFile } from 'yauzl';

import type { ContentResult } from '@/lib/content/content-errors';
import type { ContentProblem } from '@/lib/content/contract';
import { causeMessage } from '@/lib/errors';

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
   openEntryStream: (record: ZipEntryRecord) => Promise<ContentResult<Readable>>;
   close: () => void;
};

export async function openZipArchive(archivePath: string, options: { maxEntries: number }): Promise<ContentResult<ZipArchive>> {
   const opened = await Result.tryPromise({
      try: () => openZipFileHandle(archivePath),
      catch: (cause) => describeZipFailure(cause, archivePath)
   });
   if (Result.isError(opened)) return Result.err<ZipArchive, ContentProblem>(opened.error);

   const zipFile = opened.value;

   if (zipFile.entryCount > options.maxEntries) {
      zipFile.close();
      return Result.err<ZipArchive, ContentProblem>({
         code: 'content.archive.too-many-entries',
         message: 'the archive holds more files than allowed',
         path: archivePath,
         detail: `${options.maxEntries} entries`
      });
   }

   const entries = await Result.tryPromise({
      try: () => readZipEntries(zipFile),
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

export function describeUnsupportedZipEntry(record: ZipEntryRecord) {
   if (record.reparsePoint) return 'the archive holds a Windows link entry';
   if (record.unixMode === null || record.unixMode === 0) return null;

   const fileType = record.unixMode & unixFileTypeMask;
   if (fileType === unixSymbolicLink) return 'the archive holds a symbolic link entry';
   if (fileType === 0) return null;
   if (fileType !== unixDirectory && fileType !== unixRegularFile) return 'the archive holds a device or special file entry';

   return null;
}

function openZipFileHandle(archivePath: string) {
   return new Promise<ZipFile>((resolve, reject) => {
      openZipFile(archivePath, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: false }, (error, zipFile) => {
         if (error) reject(error);
         else resolve(zipFile);
      });
   });
}

function readZipEntries(zipFile: ZipFile) {
   return new Promise<Entry[]>((resolve, reject) => {
      const entries: Entry[] = [];

      zipFile.on('entry', (entry: Entry) => {
         entries.push(entry);
         zipFile.readEntry();
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
      zipFile.readEntry();
   });
}

async function openEntryStream(zipFile: ZipFile, entries: Entry[], record: ZipEntryRecord, archivePath: string) {
   const entry = entries[record.index];

   if (!entry || entry.fileName !== record.name) {
      return Result.err<Readable, ContentProblem>({
         code: 'content.archive.corrupt',
         message: 'the archive changed while it was being unpacked',
         entry: record.name,
         path: archivePath
      });
   }

   return Result.tryPromise({
      try: () =>
         new Promise<Readable>((resolve, reject) => {
            zipFile.openReadStream(entry, (error, stream) => {
               if (error) reject(error);
               else resolve(stream);
            });
         }),
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

   if (rejectedPath) {
      return {
         code: 'content.archive.path-rejected',
         message: 'an archive entry uses a path Encore refuses to write',
         entry: rejectedPath[1],
         path: archivePath
      };
   }

   if (message.startsWith('End of central directory record signature not found')) {
      return { code: 'content.archive.not-zip', message: 'the file is not a zip archive', path: archivePath };
   }

   if (cause instanceof Error && 'code' in cause) {
      return { code: 'content.archive.read-failed', message: 'the archive could not be read', path: archivePath, detail: message };
   }

   return {
      code: 'content.archive.corrupt',
      message: 'the archive is damaged',
      ...(entryName ? { entry: entryName } : {}),
      path: archivePath,
      detail: message
   };
}
