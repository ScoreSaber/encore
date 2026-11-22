import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';

import { join } from 'node:path';

const contentCacheVersion = 2;
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

export type CacheLog = { warn: (message: string) => void };

type PersistentCacheOptions<Value> = {
   dataPath: string;
   log: CacheLog;
   name: string;
   valueSchema: z.ZodType<Value>;
   maxEntries?: number;
};

type LoadState = { status: 'unloaded' } | { status: 'loading'; pending: Promise<void> } | { status: 'loaded' };

export function createPersistentCache<Value>(options: PersistentCacheOptions<Value>) {
   const cachePath = join(options.dataPath, 'cache', `${options.name}.json`);
   const maxEntries = options.maxEntries ?? defaultMaxEntries;
   const entrySchema = z.object({ key: z.string(), value: options.valueSchema });
   const fileSchema = z.object({ schemaVersion: z.literal(contentCacheVersion), entries: z.array(entrySchema) });
   const entries = new Map<string, z.infer<typeof entrySchema>>();
   let loadState: LoadState = { status: 'unloaded' };
   let pendingWrite: Promise<void> | null = null;
   let dirty = false;

   async function get(key: string) {
      if (loadState.status !== 'loaded') await load();
      return readRecent(entries, key)?.value ?? null;
   }

   async function set(key: string, value: Value) {
      if (loadState.status !== 'loaded') await load();
      setRecent(entries, key, { key, value }, maxEntries);
      await save();
   }

   async function remove(key: string) {
      if (loadState.status !== 'loaded') await load();
      if (!entries.delete(key)) return;
      await save();
   }

   async function load() {
      if (loadState.status === 'loaded') return;
      if (loadState.status === 'loading') return loadState.pending;

      const pending = loadFile().finally(() => {
         loadState = { status: 'loaded' };
      });
      loadState = { status: 'loading', pending };
      await pending;
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
            root: options.dataPath
         });
         if (Result.isError(written)) {
            dirty = true;
            const { code, message, path, detail } = written.error;
            options.log.warn([`content-cache: ${code} ${message}`, path && `path=${path}`, detail && `detail=${detail}`].filter(Boolean).join(' '));
            return;
         }
      }
   }

   return { get, set, remove };
}
