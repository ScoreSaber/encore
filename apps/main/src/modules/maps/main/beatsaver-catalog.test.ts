import { Result } from 'better-result';

import { createBeatSaverCatalog } from '@/modules/maps/main/beatsaver-catalog';

import { describe, expect, test } from 'bun:test';

const hash = 'A'.repeat(40);

describe('BeatSaver catalog', () => {
   test('validates hashes and normalizes timing metadata at the response boundary', async () => {
      const requests: string[] = [];
      const catalog = createBeatSaverCatalog({
         fetchJson: (url) => {
            requests.push(url);
            return Promise.resolve(
               Response.json({
                  id: 'abc',
                  metadata: { bpm: 0, duration: -1 },
                  versions: [{ hash, downloadURL: 'https://cdn.beatsaver.com/abc.zip' }]
               })
            );
         }
      });

      const records = await catalog.getByHashes(['invalid', ` ${hash} `]);

      expect(Result.isOk(records)).toBe(true);
      if (Result.isError(records)) return;

      expect(requests).toHaveLength(1);
      expect(requests[0]).toEndWith(`/maps/hash/${hash.toLowerCase()}`);
      expect(records.value.get(hash.toLowerCase())?.summary).toMatchObject({ bpm: null, durationSeconds: null });
   });
});
