import type { ReceiverStreamInput } from '@/modules/receiver/protocol';

export const receiverHeartbeatIntervalMs = 15_000;
export const receiverBackpressureTimeoutMs = 5_000;

type ReceiverEventResponse = {
   destroyed: boolean;
   writableEnded: boolean;
   writeHead(status: number, headers: Record<string, string>): unknown;
   write(frame: string): boolean;
   end(): unknown;
   destroy(): unknown;
   once(event: 'close' | 'drain' | 'error', listener: () => void): unknown;
   off(event: 'close' | 'drain' | 'error', listener: () => void): unknown;
};

type StreamSubscriber = {
   response: ReceiverEventResponse;
   backpressured: boolean;
   backpressureTimer: ReturnType<typeof setTimeout> | null;
   drainListener: (() => void) | null;
};

export type ReceiverEventHub = ReturnType<typeof createReceiverEventHub>;

export function createReceiverEventHub(options: { heartbeatIntervalMs?: number } = {}) {
   const subscribers = new Map<string, StreamSubscriber>();
   const heartbeatIntervalMs = options.heartbeatIntervalMs ?? receiverHeartbeatIntervalMs;
   let heartbeat: ReturnType<typeof setInterval> | null = null;
   let stopped = false;

   function open() {
      stopped = false;
   }

   function attach(response: ReceiverEventResponse, deviceId: string, initialEvents: ReceiverStreamInput[]) {
      if (stopped || response.destroyed || response.writableEnded) {
         if (response.destroyed || response.writableEnded) return;

         response.writeHead(503, { 'Cache-Control': 'no-store' });
         response.end();
         return;
      }

      const subscriber: StreamSubscriber = {
         response,
         backpressured: false,
         backpressureTimer: null,
         drainListener: null
      };
      const detach = () => {
         response.off('close', detach);
         response.off('error', detach);
         clearBackpressure(subscriber);
         if (subscribers.get(deviceId) !== subscriber) return;

         subscribers.delete(deviceId);
         stopHeartbeatWhenIdle();
      };
      response.once('close', detach);
      response.once('error', detach);

      const existing = subscribers.get(deviceId);
      subscribers.set(deviceId, subscriber);
      existing?.response.end();

      response.writeHead(200, {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-store',
         Connection: 'keep-alive'
      });

      const initialFrame = [...initialEvents, heartbeatEvent()].map(encodeEvent).join('');
      if (!write(subscriber, initialFrame)) {
         detach();
         return;
      }

      startHeartbeat();
   }

   function broadcast(event: ReceiverStreamInput) {
      const frame = encodeEvent(event);

      for (const [deviceId, subscriber] of subscribers) {
         if (!write(subscriber, frame) && subscribers.get(deviceId) === subscriber) {
            subscribers.delete(deviceId);
         }
      }

      stopHeartbeatWhenIdle();
   }

   function closeDevice(deviceId: string) {
      const subscriber = subscribers.get(deviceId);
      if (!subscriber) return;

      subscribers.delete(deviceId);
      subscriber.response.end();
      stopHeartbeatWhenIdle();
   }

   function closeAll() {
      stopped = true;

      for (const subscriber of subscribers.values()) {
         subscriber.response.end();
      }

      subscribers.clear();
      stopHeartbeatWhenIdle();
   }

   function startHeartbeat() {
      if (heartbeat) return;

      heartbeat = setInterval(() => {
         broadcast(heartbeatEvent());
      }, heartbeatIntervalMs);
      heartbeat.unref?.();
   }

   function stopHeartbeatWhenIdle() {
      if (subscribers.size > 0 || !heartbeat) return;

      clearInterval(heartbeat);
      heartbeat = null;
   }

   return {
      open,
      attach,
      broadcast,
      closeDevice,
      closeAll,
      get size() {
         return subscribers.size;
      }
   };
}

function write(subscriber: StreamSubscriber, frame: string) {
   if (subscriber.response.destroyed || subscriber.response.writableEnded) return false;
   if (subscriber.backpressured) {
      subscriber.response.destroy();
      return false;
   }

   if (subscriber.response.write(frame)) return true;

   subscriber.backpressured = true;
   subscriber.drainListener = () => {
      clearBackpressure(subscriber);
   };
   subscriber.response.once('drain', subscriber.drainListener);
   subscriber.backpressureTimer = setTimeout(() => {
      subscriber.response.destroy();
   }, receiverBackpressureTimeoutMs);
   subscriber.backpressureTimer.unref?.();
   return true;
}

function clearBackpressure(subscriber: StreamSubscriber) {
   if (subscriber.backpressureTimer) clearTimeout(subscriber.backpressureTimer);
   if (subscriber.drainListener) subscriber.response.off('drain', subscriber.drainListener);
   subscriber.backpressured = false;
   subscriber.backpressureTimer = null;
   subscriber.drainListener = null;
}

function encodeEvent(event: ReceiverStreamInput) {
   return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function heartbeatEvent(): ReceiverStreamInput {
   return {
      type: 'heartbeat',
      sentAt: new Date().toISOString()
   };
}
