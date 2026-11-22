import type { FileHandle } from 'node:fs/promises';

const headerBytes = 8192;
const required32BitFlag = 0x2;

export async function readAt(file: FileHandle, position: number, length: number) {
   const buffer = Buffer.alloc(length);
   const { bytesRead } = await file.read(buffer, 0, length, position);
   return buffer.subarray(0, bytesRead);
}

export async function findClrHeader(file: FileHandle) {
   const header = await readAt(file, 0, headerBytes);
   if (header.length < 0x40 || header.toString('latin1', 0, 2) !== 'MZ') return null;
   const pe = header.readUInt32LE(0x3c);
   if (pe + 24 > header.length || header.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;

   const sectionCount = header.readUInt16LE(pe + 6);
   const optional = pe + 24;
   const directories = optional + (header.readUInt16LE(optional) === 0x20b ? 112 : 96);
   const sectionTable = optional + header.readUInt16LE(pe + 20);
   if (directories + 15 * 8 > header.length || sectionTable + sectionCount * 40 > header.length) return null;

   const sections = Array.from({ length: sectionCount }, (_, index) => {
      const at = sectionTable + index * 40;
      return {
         address: header.readUInt32LE(at + 12),
         size: Math.max(header.readUInt32LE(at + 8), header.readUInt32LE(at + 16)),
         offset: header.readUInt32LE(at + 20)
      };
   });
   const fileOffset = (rva: number) => {
      const section = sections.find((candidate) => rva >= candidate.address && rva < candidate.address + candidate.size);
      return section ? rva - section.address + section.offset : null;
   };

   const offset = fileOffset(header.readUInt32LE(directories + 14 * 8));
   if (offset === null) return null;
   const clr = await readAt(file, offset, 32);
   return clr.length < 32 ? null : { offset, clr, fileOffset };
}

export async function requireThirtyTwoBit(file: FileHandle) {
   const found = await findClrHeader(file);
   if (!found) return false;

   const flags = Buffer.alloc(4);
   flags.writeUInt32LE(found.clr.readUInt32LE(16) | required32BitFlag);
   await file.write(flags, 0, 4, found.offset + 16);
   return true;
}
