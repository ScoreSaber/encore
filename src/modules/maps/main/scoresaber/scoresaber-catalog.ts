import { Result } from 'better-result';
import { z } from 'zod';

import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import type { MapHash } from '@/modules/maps/contract';

const scoreSaberOrigin = 'https://scoresaber.com';
const fetchTimeoutMs = 15_000;
const responseSchema = z.object({ id: z.int().positive() });

export type ScoreSaberCatalog = ReturnType<typeof createScoreSaberCatalog>;

export function createScoreSaberCatalog(options: { fetchJson?: JsonDocumentFetch } = {}) {
   async function getByHash(hash: MapHash, signal?: AbortSignal) {
      const fetched = await fetchJsonResource({
         url: `${scoreSaberOrigin}/api/v2/maps/hash/${encodeURIComponent(hash)}`,
         schema: responseSchema,
         maxBytes: 256 * 1024,
         timeoutMs: fetchTimeoutMs,
         signal,
         fetchJson: options.fetchJson
      });
      if (Result.isError(fetched)) return Result.err<string, JsonDocumentProblem>(fetched.error);

      return Result.ok<string, JsonDocumentProblem>(`${scoreSaberOrigin}/map/${fetched.value.id}`);
   }

   return { getByHash };
}
