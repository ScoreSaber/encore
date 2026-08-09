import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { modelTypeSchema, type ModelHash, type ModelSaberModelSummary } from '@/modules/models/contract';
import type { ModelSaberRecord } from '@/modules/models/main/model-saber-catalog';

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

export type ModelIndex = ReturnType<typeof createModelIndex>;

export function createModelIndex(options: { dataPath: string }) {
   const indexPath = join(options.dataPath, indexFileName);
   const entries = new Map<ModelHash, ModelIndexEntry>();
   let loaded: Promise<void> | null = null;
   let dirty = false;

   async function load() {
      loaded ??= (async () => {
         const read = await readJsonFileOrDefault(indexPath, indexSchema, {
            defaultValue: { version: 1, models: {} }
         });

         for (const [hash, entry] of Object.entries(read.models)) {
            entries.set(hash, entry);
         }
      })();

      await loaded;
   }

   async function describe(hash: ModelHash) {
      await load();

      return entries.get(hash.toLowerCase()) ?? null;
   }

   async function remember(summary: ModelSaberModelSummary | ModelSaberRecord['summary']) {
      await load();

      const hash = summary.hash.toLowerCase();
      if (!hash) return;

      entries.set(hash, {
         id: summary.id,
         type: summary.type,
         name: summary.name,
         author: summary.author,
         thumbnailUrl: summary.thumbnailUrl,
         tags: summary.tags,
         publishedAt: summary.publishedAt
      });
      dirty = true;

      while (entries.size > maxEntries) {
         const oldest = entries.keys().next();
         if (oldest.done) break;
         entries.delete(oldest.value);
      }
   }

   async function flush() {
      if (!dirty) return;
      dirty = false;

      await writeJsonFileAtomic(indexPath, { version: 1, models: Object.fromEntries(entries) }, indexSchema, {
         root: options.dataPath,
         scope: 'settings'
      });
   }

   return { describe, remember, flush };
}
