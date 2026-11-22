import { expect, test } from 'vite-plus/test';

import { createLatestGuard, createSerialQueue } from '@/lib/state/machine';

test('createSerialQueue runs tasks strictly in order and does not poison on rejection', async () => {
   const queue = createSerialQueue();
   const events: string[] = [];
   const firstGate = Promise.withResolvers<void>();

   const first = queue.run(async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 1;
   });
   const second = queue.run(async () => {
      events.push('second:throw');
      throw new Error('boom');
   });
   const third = queue.run(async () => {
      events.push('third:run');
      return 3;
   });

   firstGate.resolve();
   await expect(first).resolves.toBe(1);
   await expect(second).rejects.toThrow('boom');
   await expect(third).resolves.toBe(3);
   await queue.idle();
   expect(events).toEqual(['first:start', 'first:end', 'second:throw', 'third:run']);
});

test('createLatestGuard supersedes prior tokens and invalidates active tokens', () => {
   const guard = createLatestGuard();
   const first = guard.next();
   expect(guard.isCurrent(first)).toBe(true);

   const second = guard.next();
   expect(guard.isCurrent(first)).toBe(false);
   expect(guard.isCurrent(second)).toBe(true);

   guard.invalidate();
   expect(guard.isCurrent(second)).toBe(false);
});
