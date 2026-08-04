import { zipSync } from 'fflate';

type ZipEntry = { name: string; content: Buffer };

export function createZipArchive(entries: ZipEntry[]) {
   return Buffer.from(zipSync(Object.fromEntries(entries.map((entry) => [entry.name, new Uint8Array(entry.content)]))));
}
