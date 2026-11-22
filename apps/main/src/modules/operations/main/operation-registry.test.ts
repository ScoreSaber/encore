import { expect, test, vi } from 'vite-plus/test';

import { createOperationRegistry } from '@/modules/operations/main/operation-registry';

test('deduplicates concurrent cancels and preserves terminal completion during async cancel', async () => {
   const registry = createOperationRegistry();
   const cancelGate = Promise.withResolvers<void>();
   const cancelHandler = vi.fn(() => cancelGate.promise);

   const first = registry.create({ kind: 'download', title: 'Download', cancel: cancelHandler });
   const cancelA = registry.cancel({ id: first.id });
   const cancelB = registry.cancel({ id: first.id });
   expect(cancelHandler).toHaveBeenCalledOnce();

   cancelGate.resolve();
   const [resultA, resultB] = await Promise.all([cancelA, cancelB]);
   expect(resultA).toMatchObject({ ok: true, status: 'cancelled' });
   expect(resultB).toEqual(resultA);

   const raceGate = Promise.withResolvers<void>();
   const second = registry.create({ kind: 'download', title: 'Race', cancel: () => raceGate.promise });
   const cancelling = registry.cancel({ id: second.id });
   registry.complete(second.id, { ok: true });
   raceGate.resolve();

   expect(await cancelling).toMatchObject({ ok: true, status: 'noop', reason: 'already-finished' });
   expect(registry.list().find((entry) => entry.id === second.id)?.status).toBe('completed');
});

test('restores running phase after a failed cancel handler so the operation can finish', async () => {
   const registry = createOperationRegistry();
   let shouldFail = true;
   const operation = registry.create({
      kind: 'download',
      title: 'Flaky cancel',
      cancel: async () => {
         if (shouldFail) {
            shouldFail = false;
            throw new Error('cannot cancel yet');
         }
      }
   });

   expect(await registry.cancel({ id: operation.id })).toMatchObject({ ok: false, status: 'failed' });
   expect(await registry.cancel({ id: operation.id })).toMatchObject({ ok: true, status: 'cancelled' });
});

test('dispose cancels active cancelable operations and prevents post-dispose work', async () => {
   const registry = createOperationRegistry();
   const cancelHandler = vi.fn();
   const operation = registry.create({ kind: 'download', title: 'In flight', cancel: cancelHandler });

   await registry.dispose();
   expect(cancelHandler).toHaveBeenCalledOnce();
   expect(registry.list()).toEqual([]);
   expect(registry.update(operation.id, { message: 'late' })).toBeUndefined();

   const run = vi.fn(async () => undefined);
   const release = vi.fn();
   const controller = new AbortController();
   const rejected = registry.start({ kind: 'download', title: 'After dispose' }, run, {
      signal: controller.signal,
      cancel: () => controller.abort(),
      release
   });
   expect(rejected.status).toBe('cancelled');
   expect(run).not.toHaveBeenCalled();
   expect(release).toHaveBeenCalledOnce();
});
