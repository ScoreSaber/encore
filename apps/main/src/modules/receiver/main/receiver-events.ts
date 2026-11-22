import type { ReceiverStreamInput } from '@/modules/receiver/protocol';

import type { ServerResponse } from 'node:http';

const receiverHeartbeatIntervalMs = 15_000;
const receiverBackpressureTimeoutMs = 5_000;

type BackpressureState = { status: 'flowing' } | { status: 'waiting'; timer: ReturnType<typeof setTimeout>; onDrain: () => void };

type StreamSubscriber = {
   response: ServerResponse;
   backpressure: BackpressureState;
   detach: () => void;
};

export function createReceiverEventHub(onConnectedChange: (deviceIds: string[]) => void) {
   const subscribers = new Map<string, StreamSubscriber>();
   let heartbeat: ReturnType<typeof setInterval> | null = null;
   let openState: 'closed' | 'open' = 'closed';
   let connected = '';

   function open() {
      openState = 'open';
   }

   function attach(response: ServerResponse, deviceId: string, initialEvents: ReceiverStreamInput[]) {
      if (response.destroyed || response.writableEnded) return;
      if (openState === 'closed') {
         response.writeHead(503, { 'Cache-Control': 'no-store' });
         response.end();
         return;
      }

      const subscriber: StreamSubscriber = {
         response,
         backpressure: { status: 'flowing' },
         detach: () => {
            response.off('close', subscriber.detach);
            response.off('error', subscriber.detach);
            clearBackpressure(subscriber);
            if (subscribers.get(deviceId) !== subscriber) return;

            subscribers.delete(deviceId);
            settle();
         }
      };
      response.once('close', subscriber.detach);
      response.once('error', subscriber.detach);

      const existing = subscribers.get(deviceId);
      subscribers.set(deviceId, subscriber);
      if (existing) {
         clearBackpressure(existing);
         existing.response.end();
      }

      response.writeHead(200, {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-store',
         Connection: 'keep-alive'
      });

      const initialFrame = [...initialEvents, heartbeatEvent()].map(encodeEvent).join('');
      if (!write(subscriber, initialFrame)) {
         subscriber.detach();
         return;
      }

      startHeartbeat();
      settle();
   }

   function broadcast(event: ReceiverStreamInput) {
      const frame = encodeEvent(event);

      for (const [deviceId, subscriber] of subscribers) {
         if (!write(subscriber, frame) && subscribers.get(deviceId) === subscriber) {
            clearBackpressure(subscriber);
            subscribers.delete(deviceId);
         }
      }

      settle();
   }

   function closeDevice(deviceId: string) {
      const subscriber = subscribers.get(deviceId);
      if (!subscriber) return;

      clearBackpressure(subscriber);
      subscribers.delete(deviceId);
      subscriber.response.end();
      settle();
   }

   function closeAll() {
      openState = 'closed';

      for (const subscriber of subscribers.values()) {
         clearBackpressure(subscriber);
         subscriber.response.end();
      }

      subscribers.clear();
      settle();
   }

   function startHeartbeat() {
      if (heartbeat) return;

      heartbeat = setInterval(() => {
         broadcast(heartbeatEvent());
      }, receiverHeartbeatIntervalMs);
      heartbeat.unref();
   }

   function settle() {
      const deviceIds = [...subscribers.keys()].sort();
      if (deviceIds.join('\n') !== connected) {
         connected = deviceIds.join('\n');
         onConnectedChange(deviceIds);
      }
      if (subscribers.size > 0 || !heartbeat) return;

      clearInterval(heartbeat);
      heartbeat = null;
   }

   return {
      open,
      attach,
      broadcast,
      closeDevice,
      closeAll
   };
}

function write(subscriber: StreamSubscriber, frame: string) {
   if (subscriber.response.destroyed || subscriber.response.writableEnded) return false;
   if (subscriber.response.write(frame)) {
      clearBackpressure(subscriber);
      return true;
   }
   if (subscriber.backpressure.status === 'waiting') return true;

   const onDrain = () => {
      clearBackpressure(subscriber);
   };
   const timer = setTimeout(() => {
      clearBackpressure(subscriber);
      subscriber.response.destroy();
   }, receiverBackpressureTimeoutMs);
   timer.unref();
   subscriber.backpressure = { status: 'waiting', timer, onDrain };
   subscriber.response.once('drain', onDrain);
   return true;
}

function clearBackpressure(subscriber: StreamSubscriber) {
   if (subscriber.backpressure.status !== 'waiting') return;

   clearTimeout(subscriber.backpressure.timer);
   subscriber.response.off('drain', subscriber.backpressure.onDrain);
   subscriber.backpressure = { status: 'flowing' };
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
