import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import type { JsonDocumentFetch } from '@/lib/http/json';
import { createSerialQueue } from '@/lib/state/machine';
import { scoreSaberModSourceId, scoreSaberModSourceUrl, type ModRepositoryIssue, type ModRepositoryRecord } from '@/modules/mods/contract';
import { fetchRepositoryListing, modRepositoryListingSchema } from '@/modules/mods/main/repo-listing';

import { join } from 'node:path';

const cacheFileName = 'mod-repositories.json';
const cacheVersion = 1;
const listingTtlMs = 30 * 60 * 1000;
const retryAfterFailureMs = 5 * 60 * 1000;

const cachedListingSchema = z.object({
   id: z.string(),
   listingUrl: z.string(),
   fetchedAt: z.string(),
   etag: z.string().nullable().default(null),
   lastModified: z.string().nullable().default(null),
   listing: modRepositoryListingSchema
});

const cacheFileSchema = z.object({
   schemaVersion: z.literal(cacheVersion),
   repositories: z.array(cachedListingSchema.nullable().catch(null)).default([])
});

type CachedListing = z.infer<typeof cachedListingSchema>;

type RepositoryListingState = {
   cached: CachedListing | null;
   failedAt?: number;
   failedUrl?: string;
   issue?: ModRepositoryIssue;
   detail?: string;
};

type CacheLoadState = { status: 'unloaded' } | { status: 'loading'; promise: Promise<void> } | { status: 'loaded' };

type ListedRepository = Pick<ModRepositoryRecord, 'id' | 'listingUrl'>;

export function createRepositoryListingCache(options: { dataPath: string; now: () => number; fetchJson?: JsonDocumentFetch }) {
   const cachePath = join(options.dataPath, cacheFileName);
   const states = new Map<string, RepositoryListingState>();
   const generations = new Map<string, number>();
   const inFlight = new Map<string, Promise<RepositoryListingState>>();
   const writeQueue = createSerialQueue();
   let loadState: CacheLoadState = { status: 'unloaded' };

   async function get(id: string) {
      await loadFile();
      return states.get(id);
   }

   async function load(repository: ListedRepository, input: { force: boolean }): Promise<RepositoryListingState> {
      await loadFile();
      const state = states.get(repository.id) ?? { cached: null };
      const current = state.cached?.listingUrl === repository.listingUrl ? state.cached : null;
      const fresh = current && options.now() - Date.parse(current.fetchedAt) < listingTtlMs;
      if (!input.force && fresh) return { cached: current };
      const failedSameUrl = state.failedUrl === undefined || state.failedUrl === repository.listingUrl;
      if (!input.force && failedSameUrl && state.failedAt !== undefined && options.now() - state.failedAt < retryAfterFailureMs) return state;

      const key = `${repository.id}\0${repository.listingUrl}`;
      const existing = inFlight.get(key);
      if (existing) return existing;

      const generation = generations.get(repository.id) ?? 0;
      const started = (async (): Promise<RepositoryListingState> => {
         const fetched = await fetchRepositoryListing({
            url: repository.listingUrl,
            etag: current?.etag,
            lastModified: current?.lastModified,
            fetchJson: options.fetchJson
         });
         if ((generations.get(repository.id) ?? 0) !== generation) return { cached: null };

         if (Result.isError(fetched)) return remember(repository.id, repository.listingUrl, current, fetched.error.issue, fetched.error.detail);

         const fetchedAt = new Date(options.now()).toISOString();
         if (fetched.value.status === 'not-modified') {
            return current
               ? storeInternal({ ...current, fetchedAt }, generation)
               : remember(repository.id, repository.listingUrl, null, 'fetch-failed', 'the listing answered as unchanged with nothing cached');
         }
         if (fetched.value.listing.id !== repository.id) {
            return remember(repository.id, repository.listingUrl, current, 'invalid-listing', 'the repository ID changed');
         }

         return storeInternal(
            {
               id: repository.id,
               listingUrl: repository.listingUrl,
               fetchedAt,
               etag: fetched.value.etag,
               lastModified: fetched.value.lastModified,
               listing: fetched.value.listing
            },
            generation
         );
      })().finally(() => {
         if (inFlight.get(key) === started) inFlight.delete(key);
      });
      inFlight.set(key, started);

      return started;
   }

   async function store(cached: CachedListing): Promise<RepositoryListingState> {
      await loadFile();
      const generation = (generations.get(cached.id) ?? 0) + 1;
      generations.set(cached.id, generation);
      return storeInternal(cached, generation);
   }

   async function storeInternal(cached: CachedListing, generation: number): Promise<RepositoryListingState> {
      if ((generations.get(cached.id) ?? 0) !== generation) return { cached: null };
      const next: RepositoryListingState = { cached };
      states.set(cached.id, next);
      await saveFile();

      return next;
   }

   async function remove(id: string) {
      await loadFile();
      generations.set(id, (generations.get(id) ?? 0) + 1);
      states.delete(id);
      await saveFile();
   }

   function remember(id: string, listingUrl: string, cached: CachedListing | null, issue: ModRepositoryIssue, detail?: string) {
      const next: RepositoryListingState = { cached, issue, failedAt: options.now(), failedUrl: listingUrl };
      if (detail) next.detail = detail;
      states.set(id, next);

      return next;
   }

   function loadFile() {
      if (loadState.status === 'loaded') return Promise.resolve();
      if (loadState.status === 'loading') return loadState.promise;

      const promise = readFile().then(
         () => {
            loadState = { status: 'loaded' };
         },
         (error) => {
            loadState = { status: 'unloaded' };
            throw error;
         }
      );
      loadState = { status: 'loading', promise };
      return promise;
   }

   async function readFile() {
      const read = await readJsonFileOrDefault(cachePath, cacheFileSchema, { defaultValue: { schemaVersion: cacheVersion, repositories: [] } });
      let migrated = false;

      for (const cached of read.repositories) {
         if (!cached) continue;
         if (
            cached.id.trim().toLowerCase() === scoreSaberModSourceId &&
            (cached.id !== scoreSaberModSourceId || cached.listingUrl !== scoreSaberModSourceUrl)
         ) {
            migrated = true;
            continue;
         }

         states.set(cached.id, { cached });
      }

      if (migrated) await saveFile();
   }

   async function saveFile() {
      await writeQueue.run(async () => {
         const repositories = [...states.values()].map((state) => state.cached).filter((cached) => cached !== null);

         await writeJsonFileAtomic(cachePath, { schemaVersion: cacheVersion, repositories }, cacheFileSchema, {
            root: options.dataPath
         });
      });
   }

   return { get, load, store, remove };
}
