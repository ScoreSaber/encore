import { Result } from 'better-result';

import type { MapHash, MapProblem } from '@/modules/maps/contract';
import type { MapInfo } from '@/modules/maps/main/map-info';
import { createMapProblem, type MapResult } from '@/modules/maps/main/map-problem';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';

export type MapHashInput = {
   mapPath: string;
   folderName: string;
   rawInfo: string;
   info: MapInfo;
};

export async function computeMapHash(input: MapHashInput): Promise<MapResult<MapHash>> {
   return Result.tryPromise({
      try: async () => {
         const hash = createHash('sha1');
         hash.update(input.rawInfo);

         if (input.info.audioDataFileName) await updateHashFromFile(hash, join(input.mapPath, input.info.audioDataFileName));

         for (const difficulty of input.info.difficulties) {
            await updateHashFromFile(hash, join(input.mapPath, difficulty.beatmapFileName));
            if (difficulty.lightshowFileName) await updateHashFromFile(hash, join(input.mapPath, difficulty.lightshowFileName));
         }

         return hash.digest('hex');
      },
      catch: (cause): MapProblem =>
         createMapProblem('maps.hash.failed', 'a file this map lists is missing or unreadable', { folderName: input.folderName, cause })
   });
}

async function updateHashFromFile(hash: ReturnType<typeof createHash>, path: string) {
   for await (const chunk of createReadStream(path)) {
      hash.update(chunk);
   }
}
