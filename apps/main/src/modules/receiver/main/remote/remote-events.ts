import type { z } from 'zod';

import type { DomainApi, SnapshotOutput, TargetSnapshot } from '@/lib/api';
import { insecureStorageMessage, type RemoteSession } from '@/modules/receiver/main/remote/remote-session';
import type { ReceiverStreamEvent } from '@/modules/receiver/protocol';
import type { Target, TargetEvent } from '@/modules/targets/contract';

export function createRemoteEvents(apis: readonly DomainApi[]) {
   const snapshots = new Map<string, NonNullable<DomainApi['snapshot']>>();
   for (const api of apis) {
      if (api.snapshot) snapshots.set(api.namespace, api.snapshot);
   }
   const targetListeners = new Set<(event: TargetEvent) => void>();
   const snapshotListeners = new Map<string, Set<(event: TargetSnapshot<unknown>) => void>>();

   function emit(event: TargetEvent) {
      for (const listener of targetListeners) listener(event);
   }

   function emitTarget(session: RemoteSession) {
      emit({ type: 'target-updated', target: session.target });
   }

   function updateTarget(session: RemoteSession, update: Partial<Target>) {
      session.target = { ...session.target, ...update };
      emitTarget(session);
   }

   function handleStreamEvent(session: RemoteSession, event: ReceiverStreamEvent) {
      if (event.type === 'heartbeat') return;

      if (event.type === 'target') {
         updateTarget(session, {
            status: 'ready',
            capabilities: event.target.capabilities,
            message: session.tokenPersisted ? undefined : insecureStorageMessage
         });
         return;
      }

      const snapshot = snapshots.get(event.namespace)?.safeParse(event.value);
      if (!snapshot?.success) return;

      for (const listener of snapshotListeners.get(event.namespace) ?? []) {
         listener({ targetId: session.record.id, snapshot: snapshot.data });
      }
   }

   function subscribe(listener: (event: TargetEvent) => void) {
      targetListeners.add(listener);
      return () => {
         targetListeners.delete(listener);
      };
   }

   function subscribeSnapshots<Api extends DomainApi & { snapshot: z.ZodType }>(
      api: Api,
      listener: (event: TargetSnapshot<SnapshotOutput<Api>>) => void
   ) {
      const listeners = snapshotListeners.get(api.namespace) ?? new Set();
      const erasedListener = listener as (event: TargetSnapshot<unknown>) => void;
      listeners.add(erasedListener);
      snapshotListeners.set(api.namespace, listeners);

      return () => {
         listeners.delete(erasedListener);
         if (listeners.size === 0) snapshotListeners.delete(api.namespace);
      };
   }

   return { emit, emitTarget, updateTarget, handleStreamEvent, subscribe, subscribeSnapshots };
}

export type RemoteEvents = ReturnType<typeof createRemoteEvents>;
