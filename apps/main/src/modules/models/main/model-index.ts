import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFile, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { createSerialQueue } from '@/lib/state/machine';
import { modelTypeSchema, type ModelHash, type CatalogModelSummary } from '@/modules/models/contract';

import { join } from 'node:path';

const indexFileName = 'model-index.json';
const maxEntries = 5_000;

const entrySchema = z.object({
   id: z.string(),
   type: modelTypeSchema,
   name: z.string(),
   author: z.string(),
   thumbnailUrl: z.string().nullable(),
   tags: z.array(z.string()),
   publishedAt: z.string().nullable()
});

const indexSchema = z.object({
   version: z.literal(1),
   models: z.record(z.string(), entrySchema)
});

type ModelIndexEntry = z.infer<typeof entrySchema>;
type LoadState = { status: 'unloaded' } | { status: 'loading'; promise: Promise<void> } | { status: 'loaded' };

export function createModelIndex(options: { dataPath: string }) {
   const indexPath = join(options.dataPath, indexFileName);
   const entries = new Map<ModelHash, ModelIndexEntry>();
   const writeQueue = createSerialQueue();
   let loadState: LoadState = { status: 'unloaded' };
   let dirtyVersion = 0;
   let flushedVersion = 0;

   async function load() {
      if (loadState.status === 'loaded') return;
      if (loadState.status === 'loading') {
         await loadState.promise;
         return;
      }

      const promise = (async () => {
         const read = await readJsonFile(indexPath, indexSchema, {
            defaultValue: { version: 1, models: {} }
         });
         if (Result.isError(read)) {
            loadState = read.error.code === 'filesystem.json.read-failed' ? { status: 'unloaded' } : { status: 'loaded' };
            return;
         }

         for (const [hash, entry] of Object.entries(read.value.models)) {
            if (!entries.has(hash)) entries.set(hash, entry);
         }
         loadState = { status: 'loaded' };
      })();
      loadState = { status: 'loading', promise };

      await promise;
   }

   async function describe(hash: ModelHash) {
      await load();

      return entries.get(hash) ?? null;
   }

   async function remember(summary: CatalogModelSummary) {
      await load();

      entries.set(summary.hash, {
         id: summary.id,
         type: summary.type,
         name: summary.name,
         author: summary.author,
         thumbnailUrl: summary.thumbnailUrl,
         tags: summary.tags,
         publishedAt: summary.publishedAt
      });
      dirtyVersion += 1;

      while (entries.size > maxEntries) {
         const oldest = entries.keys().next();
         if (oldest.done) break;
         entries.delete(oldest.value);
      }
   }

   async function flush() {
      await writeQueue.run(async () => {
         const targetVersion = dirtyVersion;
         if (targetVersion === flushedVersion) return;

         const written = await writeJsonFileAtomic(indexPath, { version: 1, models: Object.fromEntries(entries) }, indexSchema, {
            root: options.dataPath
         });
         if (Result.isOk(written)) flushedVersion = Math.max(flushedVersion, targetVersion);
      });
   }

   return { describe, remember, flush };
}
