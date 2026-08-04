import type { DomainApi } from '@/lib/api';
import type { RemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import { createRemoteEvents } from '@/modules/receiver/main/remote/remote-events';
import { createRemoteRequest } from '@/modules/receiver/main/remote/remote-request';
import { createRemoteSessionManager } from '@/modules/receiver/main/remote/remote-session';

export type RemoteReceiverClient = ReturnType<typeof createRemoteReceiverClient>;

export function createRemoteReceiverClient(options: { store: RemoteTargetStore; apis: readonly DomainApi[] }) {
   const events = createRemoteEvents(options.apis);
   const manager = createRemoteSessionManager({ store: options.store, events });
   const request = createRemoteRequest(manager);

   return {
      callTarget: request.targetProcedure,
      restore: manager.restore,
      pair: manager.pair,
      forget: manager.forget,
      listTargets: manager.listTargets,
      getHealth: manager.getHealth,
      uploadTarget: request.targetUpload,
      subscribe: events.subscribe,
      subscribeSnapshots: events.subscribeSnapshots,
      dispose: manager.dispose
   };
}
