import { isSafeFileName } from '@/lib/filesystem/path';

import { extname } from 'node:path';

export const maxCoverBytes = 4 * 1024 * 1024;
const maxCoverResponseCharacters = 6 * 1024 * 1024;

const coverMimeTypes = new Map([
   ['.jpeg', 'image/jpeg'],
   ['.jpg', 'image/jpeg'],
   ['.png', 'image/png'],
   ['.webp', 'image/webp']
]);

export function coverMimeType(coverFileName: string) {
   if (!isSafeFileName(coverFileName)) return null;
   return coverMimeTypes.get(extname(coverFileName).toLowerCase()) ?? null;
}

export function coverDataUrl(mimeType: string, bytes: Buffer) {
   return bytes.byteLength > maxCoverBytes ? null : `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export function packCovers(read: ({ mapId: string; dataUrl: string } | null)[]) {
   const covers = [];
   const deferredMapIds = [];
   let responseCharacters = 0;

   for (const cover of read) {
      if (!cover) continue;
      if (responseCharacters + cover.dataUrl.length > maxCoverResponseCharacters) {
         deferredMapIds.push(cover.mapId);
         continue;
      }

      covers.push(cover);
      responseCharacters += cover.dataUrl.length;
   }

   return { covers, deferredMapIds };
}
