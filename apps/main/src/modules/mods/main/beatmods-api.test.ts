import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { beatModsVersionSchema, createBeatModsApi } from '@/modules/mods/main/beatmods-api';

describe('BeatMods API', () => {
   test('validates MD5 fields with the shared digest schema', () => {
      const parsed = beatModsVersionSchema.safeParse({
         id: 1,
         modId: 2,
         modVersion: '1.0.0',
         zipHash: ` ${'A'.repeat(32)} `,
         contentHashes: [{ path: 'plugin.dll', hash: 'b'.repeat(32) }]
      });

      expect(parsed.success && parsed.data.zipHash).toBe('A'.repeat(32));
      expect(beatModsVersionSchema.safeParse({ id: 1, modId: 2, modVersion: '1.0.0', zipHash: 'not-an-md5' }).success).toBe(false);
   });

   test('rejects an invalid hash before making a lookup request', async () => {
      let requested = false;
      const api = createBeatModsApi({
         fetchJson: () => {
            requested = true;
            return Promise.resolve(Response.json({ modVersions: [] }));
         }
      });

      const found = await api.lookupHash('not-an-md5');

      expect(Result.isError(found)).toBe(true);
      expect(requested).toBe(false);
   });
});
