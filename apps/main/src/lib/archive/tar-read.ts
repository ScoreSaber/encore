import { gunzipSync } from 'node:zlib';

const blockSize = 512;
const regularFile = 0x30;

export function* readTarGzFiles(archive: Uint8Array) {
   const tar = gunzipSync(archive);

   for (let offset = 0; offset + blockSize <= tar.length;) {
      const header = tar.subarray(offset, offset + blockSize);
      const name = field(header, 0, 100);
      if (!name) return;

      const size = Number.parseInt(field(header, 124, 12), 8);
      const data = tar.subarray(offset + blockSize, offset + blockSize + size);
      offset += blockSize + Math.ceil(size / blockSize) * blockSize;

      const prefix = field(header, 257, 6) === 'ustar' ? field(header, 345, 155) : '';
      if (header[156] === regularFile || header[156] === 0) yield { name: prefix ? `${prefix}/${name}` : name, data };
   }
}

function field(block: Buffer, start: number, length: number) {
   const end = block.indexOf(0, start);
   return block.toString('latin1', start, end < 0 ? start + length : Math.min(end, start + length)).trim();
}
