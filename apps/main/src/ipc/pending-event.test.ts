import { describe, expect, test } from 'vite-plus/test';

import { createPendingIpcEvent } from '@/ipc/pending-event';

describe('pending IPC events', () => {
   test('retains an event opened before the renderer subscribes', () => {
      const events = createPendingIpcEvent<{ id: number }>(() => undefined);

      events.publish({ id: 1 });
      expect(events.take()).toEqual({ id: 1 });
      expect(events.take()).toBeNull();
   });
});
