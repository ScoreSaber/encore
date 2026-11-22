import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { createSerialQueue } from '@/lib/state/machine';
import { installColorSchema, installNameSchema, type InstallRegistrySnapshot } from '@/modules/installs/contract';
import { isQuestTargetId, type TargetId } from '@/modules/targets/contract';

import { join } from 'node:path';

const appearanceSchema = z.object({
   name: installNameSchema.optional(),
   color: installColorSchema.nullable().optional(),
   pinned: z.boolean().optional()
});
const storeSchema = z.record(z.string().refine(isQuestTargetId), appearanceSchema);
type Appearance = z.infer<typeof appearanceSchema>;

export type QuestInstallAppearance = ReturnType<typeof createQuestInstallAppearance>;

export function createQuestInstallAppearance(dataPath: string) {
   const storePath = join(dataPath, 'quest-installs.json');
   const listeners = new Set<(targetId: TargetId) => void>();
   const stored = readJsonFileOrDefault(storePath, storeSchema, { defaultValue: {} });
   const appearances = new Map<TargetId, Appearance>();
   void stored.then((value) => {
      for (const [targetId, appearance] of Object.entries(value)) {
         if (appearances.has(targetId)) continue;
         appearances.set(targetId, appearance);
         for (const listener of listeners) listener(targetId);
      }
   });

   function apply<Install extends InstallRegistrySnapshot['installs'][number]>(targetId: TargetId, install: Install): Install {
      const appearance = appearances.get(targetId);
      return {
         ...install,
         name: appearance?.name ?? install.name,
         color: appearance?.color === undefined ? install.color : appearance.color,
         pinned: appearance?.pinned ?? install.pinned
      };
   }

   const writeQueue = createSerialQueue();

   async function update(targetId: TargetId, change: Appearance) {
      return writeQueue.run(async () => {
         await stored;
         const nextAppearance = { ...appearances.get(targetId), ...change };
         const nextMap = new Map(appearances);
         nextMap.set(targetId, nextAppearance);
         const value = Object.fromEntries(nextMap);
         const written = await writeJsonFileAtomic(storePath, value, storeSchema, { root: dataPath });
         if (Result.isOk(written)) {
            appearances.set(targetId, nextAppearance);
            for (const listener of listeners) listener(targetId);
         }
         return written;
      });
   }

   return {
      apply,
      applyAll: (targetId: TargetId, snapshot: InstallRegistrySnapshot): InstallRegistrySnapshot => ({
         ...snapshot,
         installs: snapshot.installs.map((install) => apply(targetId, install))
      }),
      update,
      subscribe(listener: (targetId: TargetId) => void) {
         listeners.add(listener);
         return () => listeners.delete(listener);
      }
   };
}
