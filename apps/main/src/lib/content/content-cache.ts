import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { logRecoveredProblem } from '@/modules/support/main/problem-log';

import { join } from 'node:path';

const contentCacheVersion = 1;
const defaultMaxEntries = 12;

export function readRecent<Key, Value>(cache: Map<Key, Value>, key: Key) {
   const value = cache.get(key);
   if (value === undefined) return undefined;

   cache.delete(key);
   cache.set(key, value);
   return value;
}

export function setRecent<Key, Value>(cache: Map<Key, Value>, key: Key, value: Value, maxEntries: number) {
   cache.delete(key);
   cache.set(key, value);

   if (cache.size > maxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
   }
}

type PersistentCacheOptions<Value> = {
   dataPath: string;
   name: string;
   valueSchema: z.ZodType<Value>;
   maxEntries?: number;
};

export function createPersistentCache<Value>(options: PersistentCacheOptions<Value>) {
   const cachePath = join(options.dataPath, 'cache', `${options.name}.json`);
   const maxEntries = options.maxEntries ?? defaultMaxEntries;
   const entrySchema = z.object({ key: z.string(), correlation: z.string(), value: options.valueSchema });
   const fileSchema = z.object({ schemaVersion: z.literal(contentCacheVersion), entries: z.array(entrySchema) });
   const entries = new Map<string, z.infer<typeof entrySchema>>();
   let loaded = false;
   let pendingLoad: Promise<void> | null = null;
   let pendingWrite: Promise<void> | null = null;
   let dirty = false;

   async function get(key: string, correlation: string): Promise<Value | null> {
      if (!loaded) await load();
      const entry = readRecent(entries, key);
      if (!entry) return null;
      if (entry.correlation === correlation) return entry.value;

      entries.delete(key);
      void save();
      return null;
   }

   async function set(key: string, correlation: string, value: Value) {
      if (!loaded) await load();
      setRecent(entries, key, { key, correlation, value }, maxEntries);
      await save();
   }

   async function remove(key: string) {
      if (!loaded) await load();
      if (!entries.delete(key)) return;

      await save();
   }

   async function load() {
      if (loaded) return;

      pendingLoad ??= loadFile().finally(() => {
         loaded = true;
         pendingLoad = null;
      });
      await pendingLoad;
   }

   async function loadFile() {
      const file = await readJsonFileOrDefault(cachePath, fileSchema, {
         defaultValue: { schemaVersion: contentCacheVersion, entries: [] }
      });

      for (const entry of file.entries) {
         setRecent(entries, entry.key, entry, maxEntries);
      }
   }

   function save() {
      dirty = true;
      pendingWrite ??= flushWrites().finally(() => {
         pendingWrite = null;
      });

      return pendingWrite;
   }

   async function flushWrites() {
      while (dirty) {
         dirty = false;
         const written = await writeJsonFileAtomic(cachePath, { schemaVersion: contentCacheVersion, entries: [...entries.values()] }, fileSchema, {
            root: options.dataPath,
            scope: 'cache'
         });
         if (Result.isError(written)) logRecoveredProblem('content-cache', written.error);
      }
   }

   return { get, set, remove };
}

type PersistedContentScanState<Snapshot, CacheEntry, Extra> = {
   snapshot: Snapshot;
   cache: Map<string, CacheEntry>;
   extra: Extra;
};

export type ContentScanCache<Snapshot, CacheEntry, Extra> = {
   load: (installId: string, installPath: string) => Promise<PersistedContentScanState<Snapshot, CacheEntry, Extra> | null>;
   save: (installId: string, installPath: string, state: PersistedContentScanState<Snapshot, CacheEntry, Extra>) => Promise<void>;
   remove: (installId: string) => Promise<void>;
};

export function createContentScanCache<Snapshot, CacheEntry, Extra>(options: {
   dataPath: string;
   name: string;
   snapshotSchema: z.ZodType<Snapshot>;
   cacheEntrySchema: z.ZodType<CacheEntry>;
   extraSchema: z.ZodType<Extra>;
}) {
   const valueSchema = z.object({
      snapshot: options.snapshotSchema,
      cache: z.array(z.tuple([z.string(), options.cacheEntrySchema])),
      extra: options.extraSchema
   });
   const persistent = createPersistentCache({ dataPath: options.dataPath, name: options.name, valueSchema });

   async function load(installId: string, installPath: string): Promise<PersistedContentScanState<Snapshot, CacheEntry, Extra> | null> {
      const stored = await persistent.get(installId, installPath);
      if (!stored) return null;

      return { snapshot: stored.snapshot, cache: new Map(stored.cache), extra: stored.extra };
   }

   function save(installId: string, installPath: string, state: PersistedContentScanState<Snapshot, CacheEntry, Extra>) {
      return persistent.set(installId, installPath, {
         snapshot: state.snapshot,
         cache: [...state.cache.entries()],
         extra: state.extra
      });
   }

   return { load, save, remove: persistent.remove };
}
