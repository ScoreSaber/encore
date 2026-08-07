import { Result } from 'better-result';

import { createScoreSaberCatalog } from '@/modules/maps/main/scoresaber/scoresaber-catalog';

import { describe, expect, test } from 'bun:test';

describe('ScoreSaber catalog', () => {
   test('validates the bounded map lookup response', async () => {
      let requested = '';
      const catalog = createScoreSaberCatalog({
         fetchJson: (url) => {
            requested = url;
            return Promise.resolve(Response.json({ id: 42, ignored: 'field' }));
         }
      });

      const result = await catalog.getByHash('abc123');
      const invalid = await createScoreSaberCatalog({
         fetchJson: () => Promise.resolve(Response.json({ id: '42' }))
      }).getByHash('abc123');

      expect(requested).toEndWith('/api/v2/maps/hash/abc123');
      expect(Result.isOk(result) ? result.value : null).toBe('https://scoresaber.com/map/42');
      expect(Result.isError(invalid) ? invalid.error.code : null).toBe('json.unexpected-shape');
   });
});
