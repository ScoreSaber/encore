import { Result } from 'better-result';

import { hashFile } from '@/lib/content/content-hash';

import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type SteamManifestFile = { segments: string[]; size: number; sha1: string };
type ProtobufField = { field: number; kind: 'varint'; value: number } | { field: number; kind: 'bytes'; value: Buffer };

const payloadMagic = 0x71f617d0;
const endMagic = 0x32c415ab;
const directoryFlag = 0x40;
const symlinkFlag = 0x200;

export async function readSteamManifest(manifestPath: string) {
   const contents = await Result.tryPromise(() => readFile(manifestPath));
   if (Result.isError(contents)) return null;

   const files = Result.try(() => parsePayload(contents.value));
   return Result.isOk(files) ? files.value : null;
}

export async function isSteamDepotComplete(depotPath: string, files: SteamManifestFile[]) {
   for (const file of files) {
      const info = await Result.tryPromise(() => lstat(join(depotPath, ...file.segments)));
      if (Result.isError(info) || !info.value.isFile() || info.value.size !== file.size) return false;
   }

   for (const file of files) {
      if (file.size === 0) continue;
      const digest = await hashFile(join(depotPath, ...file.segments), 'sha1');
      if (Result.isError(digest) || digest.value !== file.sha1) return false;
   }

   return true;
}

function parsePayload(contents: Buffer) {
   let offset = 0;
   while (offset + 4 <= contents.length) {
      const magic = contents.readUInt32LE(offset);
      if (magic === endMagic) break;

      const length = contents.readUInt32LE(offset + 4);
      const section = contents.subarray(offset + 8, offset + 8 + length);
      offset += 8 + length;
      if (magic === payloadMagic)
         return [...readFields(section)].flatMap((entry) => (entry.field === 1 && entry.kind === 'bytes' ? readMapping(entry.value) : []));
   }

   throw new Error('the manifest has no file list');
}

function readMapping(mapping: Buffer): SteamManifestFile[] {
   let name: Buffer | undefined;
   let sha1: Buffer | undefined;
   let size = 0;
   let flags = 0;
   for (const entry of readFields(mapping)) {
      if (entry.kind === 'bytes' && entry.field === 1) name = entry.value;
      else if (entry.kind === 'bytes' && entry.field === 5) sha1 = entry.value;
      else if (entry.kind === 'varint' && entry.field === 2) size = entry.value;
      else if (entry.kind === 'varint' && entry.field === 3) flags = entry.value;
   }
   if (flags & (directoryFlag | symlinkFlag)) return [];
   if (!name || !sha1) throw new Error('the manifest has an incomplete file entry');

   const segments = name.toString('utf8').split(/[\\/]/);
   if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) throw new Error('the manifest has an unsafe path');

   return [{ segments, size, sha1: sha1.toString('hex') }];
}

function* readFields(buffer: Buffer): Generator<ProtobufField> {
   let offset = 0;
   const varint = () => {
      let value = 0;
      for (let scale = 1; ; scale *= 128) {
         const byte = buffer[offset++];
         if (byte === undefined) throw new Error('the manifest ended early');
         value += (byte & 0x7f) * scale;
         if (byte < 0x80) return value;
      }
   };

   while (offset < buffer.length) {
      const key = varint();
      const field = Math.floor(key / 8);
      const wireType = key % 8;
      if (wireType === 0) yield { field, kind: 'varint', value: varint() };
      else if (wireType === 2) {
         const length = varint();
         if (offset + length > buffer.length) throw new Error('the manifest ended early');
         yield { field, kind: 'bytes', value: buffer.subarray(offset, (offset += length)) };
      } else if (wireType === 1 || wireType === 5) offset += wireType === 1 ? 8 : 4;
      else throw new Error('the manifest has an unknown field type');
   }
}
