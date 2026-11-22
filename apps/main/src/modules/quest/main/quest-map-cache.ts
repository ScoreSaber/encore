import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { createSerialQueue } from '@/lib/state/machine';
import { localMapSummarySchema, type LocalMapSummary } from '@/modules/maps/contract';
import type { TargetId } from '@/modules/targets/contract';

import { createHash } from 'node:crypto';
import { join } from 'node:path';

const folderRecordSchema = z.object({
   folderName: z.string().min(1),
   modifiedAt: z.number(),
   fileCount: z.number().int().min(0),
   map: localMapSummarySchema
});
const cacheSchema = z.object({ mapsPath: z.string(), folders: z.array(folderRecordSchema) });

export type QuestMapFolder = z.infer<typeof folderRecordSchema>;

export function createQuestMapCache(dataPath: string) {
   const pathFor = (targetId: TargetId) => join(dataPath, `quest-maps-${createHash('sha256').update(targetId).digest('hex').slice(0, 16)}.json`);

   async function load(targetId: TargetId, mapsPath: string) {
      const cached = await readJsonFileOrDefault(pathFor(targetId), cacheSchema, { defaultValue: { mapsPath, folders: [] } });
      return new Map(cached.mapsPath === mapsPath ? cached.folders.map((folder) => [folder.folderName, folder]) : []);
   }

   const queues = new Map<TargetId, ReturnType<typeof createSerialQueue>>();

   function save(targetId: TargetId, mapsPath: string, folders: ReadonlyMap<string, QuestMapFolder>) {
      let queue = queues.get(targetId);
      if (!queue) {
         queue = createSerialQueue();
         queues.set(targetId, queue);
      }
      const value = { mapsPath, folders: [...folders.values()] };
      return queue.run(() => writeJsonFileAtomic(pathFor(targetId), value, cacheSchema, { root: dataPath }));
   }

   return { load, save };
}

export function questMapFolder(map: LocalMapSummary, modifiedAt: number, fileCount: number): QuestMapFolder {
   return { folderName: map.folderName, modifiedAt, fileCount, map: { ...map, updatedAt: new Date(modifiedAt).toISOString() } };
}
