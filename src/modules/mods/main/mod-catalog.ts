import { Result } from 'better-result';
import { z } from 'zod';

import { readRecent, setRecent } from '@/lib/content/content-cache';
import { createPersistentCache } from '@/lib/content/content-cache';
import { officialModSourceId, officialModSourceName, type ModCatalogSource, type ModPlatform } from '@/modules/mods/contract';
import type { ModSourceStatus } from '@/modules/mods/contract';
import {
   beatModsModSchema,
   beatModsVersionSchema,
   createBeatModsApi,
   type BeatModsApi,
   type BeatModsEntry,
   type BeatModsProblem
} from '@/modules/mods/main/beatmods-api';
import {
   buildModIndex,
   modIndexKey,
   toModIndexEntries,
   type ModIndex,
   type ModIndexEntry,
   type ModIndexFileMatch
} from '@/modules/mods/main/mod-index';

const defaultTtlMs = 10 * 60 * 1000;
const maxHashLookups = 80;
const maxCachedCatalogs = 4;
const maxCachedHashLookups = maxHashLookups * 2;
const beatModsEntrySchema = z.object({ mod: beatModsModSchema, version: beatModsVersionSchema });
const catalogCacheValueSchema = z.object({ entries: z.array(beatModsEntrySchema), fetchedAt: z.int().nonnegative() });

export type ModCatalogRequest = {
   gameVersion: string;
   platform: ModPlatform;
};

export type ModRepositoryEntries = {
   listEntries: (request: ModCatalogRequest) => Promise<{
      sources: ModSourceStatus[];
      entries: ModIndexEntry[];
      fileMatches: ModIndexFileMatch[];
   }>;
   isOfficialEnabled: () => Promise<boolean>;
};

export type ModCatalogOptions = {
   dataPath: string;
   api?: BeatModsApi;
   repositories?: ModRepositoryEntries;
   ttlMs?: number;
};

export type ModHashMatch = {
   modId: string;
   version: string;
};

export type ModCatalogService = ReturnType<typeof createModCatalogService>;

export function createModCatalogService(options: ModCatalogOptions) {
   const api = options.api ?? createBeatModsApi();
   const ttlMs = options.ttlMs ?? defaultTtlMs;
   const catalogs = new Map<string, { entries: BeatModsEntry[]; fetchedAt: number }>();
   const refreshes = new Map<string, Promise<Result<ModIndex, BeatModsProblem>>>();
   const hashLookups = new Map<string, ModHashMatch | null>();
   const persisted = createPersistentCache({
      dataPath: options.dataPath,
      name: 'mods-catalog',
      valueSchema: catalogCacheValueSchema,
      maxEntries: maxCachedCatalogs
   });
   let lookupBudget = maxHashLookups;

   async function get(request: ModCatalogRequest): Promise<Result<ModIndex, BeatModsProblem>> {
      if (!((await options.repositories?.isOfficialEnabled()) ?? true)) return build(request, [], [], 'remote', Date.now());

      const key = `${request.platform}::${request.gameVersion}`;
      let cached = readRecent(catalogs, key);
      if (!cached) {
         const stored = await persisted.get(key, key);
         if (stored) {
            cached = stored;
            setRecent(catalogs, key, stored, maxCachedCatalogs);
         }
      }
      if (cached) {
         if (Date.now() - cached.fetchedAt >= ttlMs) void refresh(request);

         return compose(request, cached.entries, 'cache', cached.fetchedAt);
      }

      return refresh(request);
   }

   function refresh(request: ModCatalogRequest): Promise<Result<ModIndex, BeatModsProblem>> {
      const key = `${request.platform}::${request.gameVersion}`;
      const pending = refreshes.get(key);
      if (pending) return pending;

      const started = runRefresh(request, key).finally(() => {
         refreshes.delete(key);
      });
      refreshes.set(key, started);

      return started;
   }

   async function runRefresh(request: ModCatalogRequest, key: string): Promise<Result<ModIndex, BeatModsProblem>> {
      if (!((await options.repositories?.isOfficialEnabled()) ?? true)) return build(request, [], [], 'remote', Date.now());

      const status = await api.checkStatus();
      if (Result.isError(status)) return Result.err<ModIndex, BeatModsProblem>(status.error);

      const listed = await api.listMods(request);
      if (Result.isError(listed)) return Result.err<ModIndex, BeatModsProblem>(listed.error);

      const fetchedAt = Date.now();
      setRecent(catalogs, key, { entries: listed.value, fetchedAt }, maxCachedCatalogs);
      await persisted.set(key, key, { entries: listed.value, fetchedAt });
      lookupBudget = maxHashLookups;

      return compose(request, listed.value, 'remote', fetchedAt);
   }

   async function compose(
      request: ModCatalogRequest,
      entries: BeatModsEntry[],
      source: ModCatalogSource,
      fetchedAt: number
   ): Promise<Result<ModIndex, BeatModsProblem>> {
      const official = toModIndexEntries(entries);

      return build(
         request,
         official,
         [{ id: officialModSourceId, name: officialModSourceName, kind: 'official', state: 'ready', modCount: official.length }],
         source,
         fetchedAt
      );
   }

   async function build(
      request: ModCatalogRequest,
      official: ModIndexEntry[],
      officialSources: ModSourceStatus[],
      source: ModCatalogSource,
      fetchedAt: number
   ): Promise<Result<ModIndex, BeatModsProblem>> {
      const unofficial = (await options.repositories?.listEntries(request)) ?? { sources: [], entries: [], fileMatches: [] };

      return Result.ok<ModIndex, BeatModsProblem>(
         buildModIndex({
            gameVersion: request.gameVersion,
            platform: request.platform,
            source,
            updatedAt: new Date(fetchedAt).toISOString(),
            sources: [...officialSources, ...unofficial.sources],
            entries: [...official, ...unofficial.entries],
            fileMatches: unofficial.fileMatches
         })
      );
   }

   async function lookupHash(hash: string) {
      const key = hash.toLowerCase();
      const cached = readRecent(hashLookups, key);
      if (cached !== undefined) {
         return cached;
      }

      if (lookupBudget <= 0 || !((await options.repositories?.isOfficialEnabled()) ?? true)) return null;
      lookupBudget -= 1;

      const looked = await api.lookupHash(key);
      const version = Result.isOk(looked) ? looked.value : null;
      const match = version ? { modId: modIndexKey(officialModSourceId, String(version.modId)), version: version.modVersion } : null;
      setRecent(hashLookups, key, match, maxCachedHashLookups);

      return match;
   }

   return { get, refresh, lookupHash };
}
