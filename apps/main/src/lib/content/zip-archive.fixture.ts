import { zipSync, type Zippable, type ZipOptions } from 'fflate';
import { z } from 'zod';

export type ZipFixtureEntry = {
   name: string;
   data?: string | Uint8Array;
   deflate?: boolean;
   unixMode?: number;
   msdosAttributes?: number;
};

export type ZipHeaderPatch = {
   addFlags?: number;
   compressionMethod?: number;
   declaredSize?: number;
};

const localHeaderSignature = 0x04034b50;
const centralHeaderSignature = 0x02014b50;
const endOfCentralDirectorySignature = 0x06054b50;
const unixHostSystem = 3;

export function buildZipArchive(entries: readonly ZipFixtureEntry[]) {
   const files: Zippable = {};

   for (const entry of entries) {
      const options: ZipOptions = { level: entry.deflate ? 6 : 0 };
      if (entry.unixMode !== undefined) {
         options.os = unixHostSystem;
         options.attrs = (entry.unixMode << 16) >>> 0;
      }
      if (entry.msdosAttributes !== undefined) options.attrs = entry.msdosAttributes;

      const payload = z
         .union([z.string().transform((text) => new TextEncoder().encode(text)), z.instanceof(Uint8Array)])
         .optional()
         .default(new Uint8Array(0))
         .parse(entry.data);
      files[entry.name] = [payload, options];
   }

   return Buffer.from(zipSync(files));
}

export function buildCompressibleBuffer(sizeBytes: number, fill = 0x61) {
   return Buffer.alloc(sizeBytes, fill);
}

export function patchZipEntryHeaders(archive: Buffer, patch: ZipHeaderPatch) {
   const patched = Buffer.from(archive);

   for (let offset = 0; offset + 4 <= patched.length; offset += 1) {
      const signature = patched.readUInt32LE(offset);
      if (signature === localHeaderSignature) applyPatch(patched, patch, { flags: offset + 6, method: offset + 8, size: offset + 22 });
      if (signature === centralHeaderSignature) applyPatch(patched, patch, { flags: offset + 8, method: offset + 10, size: offset + 24 });
   }

   return patched;
}

export function corruptZipEntryData(archive: Buffer, marker: string) {
   const corrupted = Buffer.from(archive);
   const offset = corrupted.indexOf(marker, 0, 'utf8');
   if (offset === -1) throw new Error(`zip fixture does not hold ${marker}`);

   const byte = corrupted[offset];
   if (byte === undefined) throw new Error(`zip fixture marker ${marker} was empty`);
   corrupted[offset] = byte ^ 0xff;
   return corrupted;
}

export function truncateZipArchive(archive: Buffer) {
   const offset = archive.lastIndexOf(signatureBytes(endOfCentralDirectorySignature));
   if (offset === -1) throw new Error('zip fixture has no end of central directory record');

   return archive.subarray(0, offset);
}

function applyPatch(archive: Buffer, patch: ZipHeaderPatch, fields: { flags: number; method: number; size: number }) {
   if (patch.addFlags !== undefined) archive.writeUInt16LE(archive.readUInt16LE(fields.flags) | patch.addFlags, fields.flags);
   if (patch.compressionMethod !== undefined) archive.writeUInt16LE(patch.compressionMethod, fields.method);
   if (patch.declaredSize !== undefined) archive.writeUInt32LE(patch.declaredSize, fields.size);
}

function signatureBytes(signature: number) {
   const bytes = Buffer.alloc(4);
   bytes.writeUInt32LE(signature);

   return bytes;
}
