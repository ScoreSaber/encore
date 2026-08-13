import { describe, expect, test } from 'vite-plus/test';

import { createReceiverEventHub } from '@/modules/receiver/main/receiver-events';
import type { ReceiverStreamEvent } from '@/modules/receiver/protocol';

import { EventEmitter } from 'node:events';

const initialEvent: ReceiverStreamEvent = {
   type: 'heartbeat',
   sentAt: '2026-01-01T00:00:00.000Z'
};

describe('receiver event hub', () => {
   test('keeps only the latest stream for a paired device', () => {
      const hub = createReceiverEventHub({ heartbeatIntervalMs: 60_000 });
      const first = new TestResponse();
      const second = new TestResponse();

      hub.attach(first, 'device-1', [initialEvent]);
      hub.attach(second, 'device-1', [initialEvent]);

      expect(first.writableEnded).toBe(true);
      expect(second.writableEnded).toBe(false);
      expect(hub.size).toBe(1);
      hub.closeAll();
   });

   test('disconnects a stream before buffering a second event', () => {
      const hub = createReceiverEventHub({ heartbeatIntervalMs: 60_000 });
      const response = new TestResponse();
      hub.attach(response, 'device-1', [initialEvent]);

      response.acceptWrites = false;
      hub.broadcast(initialEvent);
      expect(response.destroyed).toBe(false);

      hub.broadcast(initialEvent);

      expect(response.destroyed).toBe(true);
      expect(hub.size).toBe(0);
   });
});

class TestResponse extends EventEmitter {
   destroyed = false;
   writableEnded = false;
   acceptWrites = true;

   writeHead() {
      return this;
   }

   write() {
      return this.acceptWrites;
   }

   end() {
      this.writableEnded = true;
      this.emit('close');
      return this;
   }

   destroy() {
      this.destroyed = true;
      this.emit('close');
      return this;
   }
}
