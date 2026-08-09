import type { OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

const defaultTimeoutMs = 10_000;

export async function waitFor(condition: () => boolean | Promise<boolean>, label = 'a condition', timeoutMs = defaultTimeoutMs) {
   const deadline = Date.now() + timeoutMs;

   while (Date.now() < deadline) {
      if (await condition()) return;

      await Bun.sleep(10);
   }

   throw new Error(`timed out waiting for ${label}`);
}

export async function waitForOperation(operations: OperationRegistry, operationId: OperationId, timeoutMs = defaultTimeoutMs) {
   const deadline = Date.now() + timeoutMs;

   while (Date.now() < deadline) {
      const snapshot = operations.list().find((candidate) => candidate.id === operationId);
      if (snapshot?.completedAt) return snapshot;

      await Bun.sleep(10);
   }

   throw new Error(`timed out waiting for operation ${operationId}`);
}
