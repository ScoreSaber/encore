import { zipSync, type Zippable, type ZipOptions } from 'fflate';

export type ZipFixtureEntry = {
   name: string;
   data?: string | Uint8Array;
   deflate?: boolean;
   unixMode?: number;
   msdosAttributes?: number;
};

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

      files[entry.name] = [Buffer.from(entry.data ?? ''), options];
   }

   return Buffer.from(zipSync(files));
}
