import { Result } from 'better-result';
import { buf as crc32 } from 'crc-32';

import type { Problem } from '@/lib/errors';

import { open, type FileHandle } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endOfDirectorySignature = 0x06054b50;
const zip64LocatorSignature = 0x07064b50;
const dataDescriptorSignature = 0x08074b50;

const localHeaderSize = 30;
const centralHeaderSize = 46;
const endOfDirectorySize = 22;
const maxComment = 0xffff;
export const maxEndOfDirectoryTailBytes = endOfDirectorySize + maxComment;

const methodStored = 0;
const methodDeflated = 8;
const dataDescriptorFlag = 0x08;

const dosDate = 0x0021;

type ApkEntry = {
   name: string;
   method: number;
   crc: number;
   compressedSize: number;
   uncompressedSize: number;
   localHeaderOffset: number;
   flags: number;
   record: Buffer;
};

export type ApkArchive = Awaited<ReturnType<typeof readApk>>;

export async function withApk<Value>(
   path: string,
   failure: (cause: unknown) => Problem,
   use: (archive: ApkArchive) => Promise<Result<Value, Problem>>
): Promise<Result<Value, Problem>> {
   const opened = await Result.tryPromise({ try: () => open(path, 'r+'), catch: failure });
   if (Result.isError(opened)) return Result.err(opened.error);

   try {
      return await Result.tryPromise({ try: async () => use(await readApk(opened.value)), catch: failure }).then(Result.flatten);
   } finally {
      await opened.value.close();
   }
}

async function readApk(handle: FileHandle) {
   const size = (await handle.stat()).size;
   const directory = await readEndOfDirectory(handle, size);
   const entries = await readCentralDirectory(handle, directory);
   const entriesEnd = await findEntriesEnd(handle, entries, directory.offset);

   const staged = new Map<string, Buffer>();
   const removed = new Set<string>();

   async function read(name: string) {
      const pending = staged.get(name);
      if (pending) return pending;

      const entry = removed.has(name) ? undefined : entries.get(name);
      if (!entry) throw new Error(`the apk has no entry named ${name}`);

      const header = await readAt(handle, entry.localHeaderOffset, localHeaderSize);
      if (header.readUInt32LE(0) !== localHeaderSignature) throw new Error(`the entry ${name} has a broken local header`);

      const dataOffset = entry.localHeaderOffset + localHeaderSize + header.readUInt16LE(26) + header.readUInt16LE(28);
      const contents = await readAt(handle, dataOffset, entry.compressedSize);

      if (entry.method === methodStored) return contents;
      if (entry.method === methodDeflated) return inflateRawSync(contents);

      throw new Error(`the entry ${name} uses an unsupported compression method`);
   }

   function write(name: string, contents: Buffer) {
      staged.set(name, contents);
      removed.delete(name);
   }

   function remove(name: string) {
      staged.delete(name);
      if (entries.has(name)) removed.add(name);
   }

   async function writeEntries() {
      const records = [...entries].filter(([name]) => !removed.has(name) && !staged.has(name)).map(([, entry]) => entry.record);
      let cursor = entriesEnd;

      for (const [name, contents] of staged) {
         const nameBytes = Buffer.from(name, 'utf8');
         const compressed = deflateRawSync(contents);
         const crc = crc32(contents) >>> 0;

         await writeAt(handle, cursor, localHeader(nameBytes, crc, compressed.length, contents.length));
         await writeAt(handle, cursor + localHeaderSize + nameBytes.length, compressed);

         records.push(centralRecord(nameBytes, crc, compressed.length, contents.length, cursor));
         cursor += localHeaderSize + nameBytes.length + compressed.length;
      }

      return { centralDirectory: Buffer.concat(records), count: records.length, entriesEnd: cursor };
   }

   return {
      handle,
      entries,
      read,
      write,
      remove,
      writeEntries
   };
}

export function uint32(value: number) {
   const bytes = Buffer.alloc(4);
   bytes.writeUInt32LE(value >>> 0, 0);

   return bytes;
}

export type ZipEndOfDirectory = {
   offsetInTail: number;
   diskInfo: number;
   diskEntries: number;
   count: number;
   size: number;
   offset: number;
   zip64: boolean;
};

export function findEndOfCentralDirectory(tail: Buffer): ZipEndOfDirectory | null {
   for (let offset = tail.length - endOfDirectorySize; offset >= 0; offset -= 1) {
      if (tail.readUInt32LE(offset) !== endOfDirectorySignature) continue;
      if (tail.readUInt16LE(offset + 20) !== tail.length - offset - endOfDirectorySize) continue;

      return {
         offsetInTail: offset,
         diskInfo: tail.readUInt32LE(offset + 4),
         diskEntries: tail.readUInt16LE(offset + 8),
         count: tail.readUInt16LE(offset + 10),
         size: tail.readUInt32LE(offset + 12),
         offset: tail.readUInt32LE(offset + 16),
         zip64: offset >= 20 && tail.readUInt32LE(offset - 20) === zip64LocatorSignature
      };
   }

   return null;
}

export function parseCentralDirectory(contents: Buffer, count: number): Result<ApkEntry[], 'corrupt' | 'zip64'> {
   const entries: ApkEntry[] = [];
   let offset = 0;

   for (let index = 0; index < count; index += 1) {
      if (offset + centralHeaderSize > contents.length || contents.readUInt32LE(offset) !== centralHeaderSignature) {
         return Result.err('corrupt');
      }

      const nameLength = contents.readUInt16LE(offset + 28);
      const recordLength = centralHeaderSize + nameLength + contents.readUInt16LE(offset + 30) + contents.readUInt16LE(offset + 32);
      if (offset + recordLength > contents.length) return Result.err('corrupt');

      const compressedSize = contents.readUInt32LE(offset + 20);
      const uncompressedSize = contents.readUInt32LE(offset + 24);
      const localHeaderOffset = contents.readUInt32LE(offset + 42);
      if ([compressedSize, uncompressedSize, localHeaderOffset].includes(0xffffffff)) {
         return Result.err('zip64');
      }

      entries.push({
         name: contents.toString('utf8', offset + centralHeaderSize, offset + centralHeaderSize + nameLength),
         flags: contents.readUInt16LE(offset + 8),
         method: contents.readUInt16LE(offset + 10),
         crc: contents.readUInt32LE(offset + 16),
         compressedSize,
         uncompressedSize,
         localHeaderOffset,
         record: contents.subarray(offset, offset + recordLength)
      });

      offset += recordLength;
   }

   return offset === contents.length ? Result.ok(entries) : Result.err('corrupt');
}

export function endOfDirectoryRecord(count: number, directorySize: number, directoryOffset: number) {
   const record = Buffer.alloc(endOfDirectorySize);
   record.writeUInt32LE(endOfDirectorySignature, 0);
   record.writeUInt16LE(count, 8);
   record.writeUInt16LE(count, 10);
   record.writeUInt32LE(directorySize, 12);
   record.writeUInt32LE(directoryOffset, 16);

   return record;
}

export async function readAt(handle: FileHandle, offset: number, length: number) {
   const buffer = Buffer.alloc(length);
   let read = 0;
   while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, offset + read);
      if (bytesRead === 0) throw new Error('the apk ended earlier than its directory claims');
      read += bytesRead;
   }

   return buffer;
}

export async function writeAt(handle: FileHandle, offset: number, contents: Buffer) {
   let written = 0;
   while (written < contents.length) {
      const { bytesWritten } = await handle.write(contents, written, contents.length - written, offset + written);
      if (bytesWritten === 0) throw new Error('the patched apk could not be fully written');
      written += bytesWritten;
   }
}

async function readEndOfDirectory(handle: FileHandle, size: number) {
   const window = Math.min(size, maxEndOfDirectoryTailBytes);
   const directory = findEndOfCentralDirectory(await readAt(handle, size - window, window));
   if (!directory) throw new Error('the file is not a zip archive');
   if (directory.zip64) throw new Error('zip64 apks are not supported');

   return directory;
}

async function readCentralDirectory(handle: FileHandle, directory: { count: number; size: number; offset: number }) {
   const parsed = parseCentralDirectory(await readAt(handle, directory.offset, directory.size), directory.count);
   if (Result.isError(parsed)) {
      throw new Error(parsed.error === 'zip64' ? 'zip64 apks are not supported' : 'the apk central directory is corrupt');
   }

   return new Map(parsed.value.map((entry) => [entry.name, entry]));
}

async function findEntriesEnd(handle: FileHandle, entries: Map<string, ApkEntry>, directoryOffset: number) {
   const last = [...entries.values()].reduce<ApkEntry | null>(
      (furthest, entry) => (furthest === null || entry.localHeaderOffset > furthest.localHeaderOffset ? entry : furthest),
      null
   );
   if (!last) return directoryOffset;

   const header = await readAt(handle, last.localHeaderOffset, localHeaderSize);
   if (header.readUInt32LE(0) !== localHeaderSignature) throw new Error('the apk has a broken local header');

   const end = last.localHeaderOffset + localHeaderSize + header.readUInt16LE(26) + header.readUInt16LE(28) + last.compressedSize;
   if ((last.flags & dataDescriptorFlag) === 0) return end;

   const marker = await readAt(handle, end, 4);
   return end + (marker.readUInt32LE(0) === dataDescriptorSignature ? 16 : 12);
}

function localHeader(name: Buffer, crc: number, compressedSize: number, uncompressedSize: number) {
   const header = Buffer.alloc(localHeaderSize + name.length);
   header.writeUInt32LE(localHeaderSignature, 0);
   header.writeUInt16LE(20, 4);
   header.writeUInt16LE(methodDeflated, 8);
   header.writeUInt16LE(dosDate, 12);
   header.writeUInt32LE(crc, 14);
   header.writeUInt32LE(compressedSize, 18);
   header.writeUInt32LE(uncompressedSize, 22);
   header.writeUInt16LE(name.length, 26);
   name.copy(header, localHeaderSize);

   return header;
}

function centralRecord(name: Buffer, crc: number, compressedSize: number, uncompressedSize: number, localHeaderOffset: number) {
   const record = Buffer.alloc(centralHeaderSize + name.length);
   record.writeUInt32LE(centralHeaderSignature, 0);
   record.writeUInt16LE(20, 4);
   record.writeUInt16LE(20, 6);
   record.writeUInt16LE(methodDeflated, 10);
   record.writeUInt16LE(dosDate, 14);
   record.writeUInt32LE(crc, 16);
   record.writeUInt32LE(compressedSize, 20);
   record.writeUInt32LE(uncompressedSize, 24);
   record.writeUInt16LE(name.length, 28);
   record.writeUInt32LE(localHeaderOffset, 42);
   name.copy(record, centralHeaderSize);

   return record;
}
