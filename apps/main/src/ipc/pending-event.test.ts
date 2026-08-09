import { createPendingIpcEvent } from '@/ipc/pending-event';

import { describe, expect, test } from 'bun:test';

describe('pending IPC events', () => {
   test('retains an event opened before the renderer subscribes', () => {
      const events = createPendingIpcEvent<{ id: number }>(() => undefined);

      events.publish({ id: 1 });
      expect(events.take()).toEqual({ id: 1 });
      expect(events.take()).toBeNull();
   });
});
