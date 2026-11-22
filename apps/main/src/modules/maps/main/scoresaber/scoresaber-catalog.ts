import { Result } from 'better-result';
import { z } from 'zod';

import { fetchJsonResource } from '@/lib/http/json';
import type { MapHash } from '@/modules/maps/contract';

const scoreSaberOrigin = 'https://scoresaber.com';
const fetchTimeoutMs = 15_000;
const responseSchema = z.object({ id: z.int().positive() });

export async function fetchScoreSaberMapUrl(hash: MapHash) {
   const fetched = await fetchJsonResource({
      url: `${scoreSaberOrigin}/api/v2/maps/hash/${encodeURIComponent(hash)}`,
      schema: responseSchema,
      maxBytes: 256 * 1024,
      timeoutMs: fetchTimeoutMs
   });

   return Result.map(fetched, ({ id }) => `${scoreSaberOrigin}/map/${id}`);
}
