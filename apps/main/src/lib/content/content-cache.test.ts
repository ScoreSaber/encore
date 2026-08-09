import { z } from 'zod';

import { createPersistentCache } from '@/lib/content/content-cache';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) await cleanup();
   cleanups.length = 0;
});

describe('persistent content cache', () => {
   test('rehydrates correlated values and discards identity mismatches', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-content-cache-'));
      cleanups.push(() => rm(dataPath, { recursive: true, force: true }));
      const valueSchema = z.object({ value: z.number() });
      const written = createPersistentCache({ dataPath, name: 'test', valueSchema });

      await written.set('install', '/game/one', { value: 1 });

      const restored = createPersistentCache({ dataPath, name: 'test', valueSchema });
      expect(await restored.get('install', '/game/one')).toEqual({ value: 1 });
      expect(await restored.get('install', '/game/two')).toBeNull();
      expect(await restored.get('install', '/game/one')).toBeNull();
   });
});
