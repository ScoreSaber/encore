import { Result } from 'better-result';
import { z } from 'zod';

import { createPersistentCache, readRecent, setRecent } from '@/lib/content/content-cache';
import { officialModSourceId, officialModSourceName, type ModCatalogSource, type ModPlatform, type ModSourceStatus } from '@/modules/mods/contract';
import { beatModsEntrySchema, createBeatModsApi, type BeatModsApi, type BeatModsEntry, type BeatModsProblem } from '@/modules/mods/main/beatmods-api';
import {
   composeModIndex,
   modIndexKey,
   toModIndexEntries,
   type ModIndex,
   type ModIndexEntry,
   type RepositoryModEntries
} from '@/modules/mods/main/mod-index';
import type { AppLogWriter } from '@/modules/support/main/app-log';

const ttlMs = 10 * 60 * 1000;
const maxHashLookups = 80;
const maxCachedCatalogs = 4;
const maxCachedHashLookups = maxHashLookups * 2;
const catalogCacheValueSchema = z.object({ entries: z.array(beatModsEntrySchema), fetchedAt: z.int().nonnegative() });

type ModCatalogRequest = {
   gameVersion: string;
   platform: ModPlatform;
};

type ModRepositoryEntries = {
   listEntries: (request: ModCatalogRequest) => Promise<RepositoryModEntries>;
   isBeatModsEnabled: () => Promise<boolean>;
};

type ModCatalogOptions = {
   dataPath: string;
   log: AppLogWriter;
   api?: BeatModsApi;
   repositories: ModRepositoryEntries;
};

type ModHashMatch = {
   modId: string;
   version: string;
};

export type ModCatalogService = ReturnType<typeof createModCatalogService>;

export function createModCatalogService(options: ModCatalogOptions) {
   const api = options.api ?? createBeatModsApi();
   const catalogs = new Map<string, { entries: BeatModsEntry[]; fetchedAt: number }>();
   const refreshes = new Map<string, Promise<Result<ModIndex, BeatModsProblem>>>();
   const hashLookups = new Map<string, ModHashMatch | null>();
   const hashInFlight = new Map<string, Promise<ModHashMatch | null>>();
   const persisted = createPersistentCache({
      dataPath: options.dataPath,
      log: options.log,
      name: 'mods-catalog',
      valueSchema: catalogCacheValueSchema,
      maxEntries: maxCachedCatalogs
   });
   let lookupBudget = maxHashLookups;
   let budgetResetAt = Date.now() + ttlMs;

   async function get(request: ModCatalogRequest): Promise<Result<ModIndex, BeatModsProblem>> {
      if (!(await options.repositories.isBeatModsEnabled())) return build(request, [], [], 'remote', Date.now());

      const key = `${request.platform}::${request.gameVersion}`;
      let cached = readRecent(catalogs, key);
      if (!cached) {
         const stored = await persisted.get(key);
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
      if (!(await options.repositories.isBeatModsEnabled())) return build(request, [], [], 'remote', Date.now());

      const [listed, repositories] = await Promise.all([api.listMods(request), options.repositories.listEntries(request)]);
      if (Result.isError(listed)) return Result.err(listed.error);

      const fetchedAt = Date.now();
      setRecent(catalogs, key, { entries: listed.value, fetchedAt }, maxCachedCatalogs);
      await persisted.set(key, { entries: listed.value, fetchedAt });
      lookupBudget = maxHashLookups;
      budgetResetAt = fetchedAt + ttlMs;

      return compose(request, listed.value, 'remote', fetchedAt, repositories);
   }

   async function compose(
      request: ModCatalogRequest,
      entries: BeatModsEntry[],
      source: ModCatalogSource,
      fetchedAt: number,
      repositories?: RepositoryModEntries
   ): Promise<Result<ModIndex, BeatModsProblem>> {
      const official = toModIndexEntries(entries);

      return build(
         request,
         official,
         [{ id: officialModSourceId, name: officialModSourceName, kind: 'official', state: 'ready', modCount: official.length }],
         source,
         fetchedAt,
         repositories
      );
   }

   async function build(
      request: ModCatalogRequest,
      official: ModIndexEntry[],
      officialSources: ModSourceStatus[],
      source: ModCatalogSource,
      fetchedAt: number,
      repositories?: RepositoryModEntries
   ): Promise<Result<ModIndex, BeatModsProblem>> {
      return Result.ok(
         composeModIndex(
            { ...request, source, fetchedAt },
            { sources: officialSources, entries: official },
            repositories ?? (await options.repositories.listEntries(request))
         )
      );
   }

   async function lookupHash(hash: string) {
      const key = hash.toLowerCase();
      const cached = readRecent(hashLookups, key);
      if (cached !== undefined) {
         return cached;
      }

      const pending = hashInFlight.get(key);
      if (pending) return pending;

      const currentTime = Date.now();
      if (currentTime >= budgetResetAt) {
         lookupBudget = maxHashLookups;
         budgetResetAt = currentTime + ttlMs;
      }

      if (lookupBudget <= 0 || !(await options.repositories.isBeatModsEnabled())) return null;
      lookupBudget -= 1;

      const started = (async () => {
         const looked = await api.lookupHash(key);
         const version = Result.isOk(looked) ? looked.value : null;
         const match = version ? { modId: modIndexKey(officialModSourceId, String(version.projectId)), version: version.semver } : null;
         setRecent(hashLookups, key, match, maxCachedHashLookups);
         return match;
      })().finally(() => {
         if (hashInFlight.get(key) === started) hashInFlight.delete(key);
      });
      hashInFlight.set(key, started);

      return started;
   }

   return { get, refresh, lookupHash };
}
