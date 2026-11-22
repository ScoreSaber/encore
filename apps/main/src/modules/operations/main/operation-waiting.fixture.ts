import type { OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { TargetId } from '@/modules/targets/contract';

import { setTimeout } from 'node:timers/promises';

const timeoutMs = 10_000;

export async function waitFor(condition: () => boolean | Promise<boolean>, label: string) {
   const deadline = Date.now() + timeoutMs;

   while (Date.now() < deadline) {
      if (await condition()) return;

      await setTimeout(10);
   }

   throw new Error(`timed out waiting for ${label}`);
}

export async function waitForOperation(operations: OperationRegistry, operationId: OperationId, options: { targetId?: TargetId } = {}) {
   const deadline = Date.now() + timeoutMs;

   while (Date.now() < deadline) {
      const snapshots = options.targetId ? operations.listForTarget(options.targetId) : operations.list();
      const snapshot = snapshots.find((candidate) => candidate.id === operationId);
      if (snapshot?.completedAt) return snapshot;

      await setTimeout(10);
   }

   throw new Error(`timed out waiting for operation ${operationId}`);
}
