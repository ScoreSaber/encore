import { Result } from 'better-result';

import type { BeatModsApi, BeatModsEntry, BeatModsProblem } from '@/modules/mods/main/beatmods-api';
import { createModCatalogService, type ModCatalogRequest } from '@/modules/mods/main/mod-catalog';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) await cleanup();
   cleanups.length = 0;
});

describe('mod catalog cache', () => {
   test('returns the per-version disk cache before its background refresh finishes', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-mod-catalog-'));
      cleanups.push(() => rm(dataPath, { recursive: true, force: true }));
      const request: ModCatalogRequest = { gameVersion: '1.40.0', platform: 'steampc' };
      const seeded = createModCatalogService({ dataPath, api: catalogApi(async () => [catalogEntry('1.0.0')]) });
      expect(Result.isOk(await seeded.refresh(request))).toBe(true);

      const { promise: refreshGate, resolve: finishRefresh } = Promise.withResolvers<void>();
      const restored = createModCatalogService({
         dataPath,
         ttlMs: 0,
         api: catalogApi(async () => {
            await refreshGate;
            return [catalogEntry('2.0.0')];
         })
      });

      const cached = await restored.get(request);
      expect(Result.isOk(cached)).toBe(true);
      if (Result.isError(cached)) return;

      expect(cached.value.source).toBe('cache');
      expect(cached.value.entries[0]?.version).toBe('1.0.0');

      const refreshing = restored.refresh(request);
      finishRefresh();
      const refreshed = await refreshing;
      expect(Result.isOk(refreshed)).toBe(true);
      if (Result.isError(refreshed)) return;

      expect(refreshed.value.source).toBe('remote');
      expect(refreshed.value.entries[0]?.version).toBe('2.0.0');
   });
});

function catalogApi(list: () => Promise<BeatModsEntry[]>): BeatModsApi {
   return {
      checkStatus: () => Promise.resolve(Result.ok<void, BeatModsProblem>(undefined)),
      listMods: async () => Result.ok<BeatModsEntry[], BeatModsProblem>(await list()),
      lookupHash: () => Promise.resolve(Result.ok<null, BeatModsProblem>(null))
   };
}

function catalogEntry(version: string): BeatModsEntry {
   return {
      mod: {
         id: 1,
         name: 'Example',
         summary: '',
         description: '',
         category: 'other',
         iconFileName: '',
         gitUrl: '',
         authors: []
      },
      version: {
         id: 2,
         modId: 1,
         modVersion: version,
         zipHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         dependencies: [],
         contentHashes: []
      }
   };
}
