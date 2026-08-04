import { Result } from 'better-result';

import { createFilesystemProblem } from '@/lib/filesystem/path';
import { beatSaberDataDirectoryName } from '@/modules/installs/main/install-root';

import { open } from 'node:fs/promises';
import { join } from 'node:path';

const versionAnchor = 'public.app-category.games';
const versionWindowBytes = 256;
const maxScanBytes = 512 * 1024;
const versionPattern = /\d+\.\d+\.\d+/;

export function beatSaberVersionFilePath(installPath: string) {
   return join(installPath, beatSaberDataDirectoryName, 'globalgamemanagers');
}

export function parseBeatSaberVersion(contents: string) {
   const anchorIndex = contents.indexOf(versionAnchor);
   if (anchorIndex < 0) return null;

   const start = anchorIndex + versionAnchor.length;
   return versionPattern.exec(contents.slice(start, start + versionWindowBytes))?.[0] ?? null;
}

export async function readBeatSaberVersion(installPath: string) {
   const versionPath = beatSaberVersionFilePath(installPath);
   const contents = await Result.tryPromise({
      try: async () => {
         const handle = await open(versionPath, 'r');

         try {
            const buffer = Buffer.alloc(maxScanBytes);
            const { bytesRead } = await handle.read(buffer, 0, maxScanBytes, 0);
            return buffer.subarray(0, bytesRead).toString('latin1');
         } finally {
            await handle.close();
         }
      },
      catch: (cause) => createFilesystemProblem('filesystem.json.read-failed', 'failed to read the Beat Saber version file', versionPath, cause)
   });

   if (Result.isError(contents)) return null;

   return parseBeatSaberVersion(contents.value);
}
