import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import type { TargetId } from '@/modules/targets/contract';

export type QuestMutationLock = ReturnType<typeof createQuestMutationLock>;

export function createQuestMutationLock() {
   const held = new Map<TargetId, symbol>();

   function acquire(targetId: TargetId) {
      if (held.has(targetId)) return Result.err(createProblem('quest.device.busy'));
      const owner = Symbol();
      const controller = new AbortController();
      let resolveReleased = () => {};
      const released = new Promise<void>((resolve) => {
         resolveReleased = resolve;
      });
      held.set(targetId, owner);

      return Result.ok({
         signal: controller.signal,
         cancel: async () => {
            controller.abort();
            await released;
         },
         release: () => {
            if (held.get(targetId) === owner) held.delete(targetId);
            resolveReleased();
         }
      });
   }

   return { acquire, busy: () => held.size > 0, isHeld: (targetId: TargetId) => held.has(targetId) };
}
