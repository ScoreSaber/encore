import type { ApiJsonValue, DomainApi, TargetSnapshot } from '@/lib/api';
import { insecureStorageMessage, relayedTargetId, type RemoteSession } from '@/modules/receiver/main/remote/remote-session';
import type { ReceiverStreamEvent } from '@/modules/receiver/protocol';
import { targetApis } from '@/modules/targets/api';
import type { Target, TargetEvent } from '@/modules/targets/contract';

export function createRemoteEvents() {
   const snapshots = new Map<string, NonNullable<DomainApi['snapshot']>>();
   for (const api of Object.values(targetApis)) {
      if (api.snapshot) snapshots.set(api.namespace, api.snapshot);
   }
   const targetListeners = new Set<(event: TargetEvent) => void>();
   const snapshotListeners = new Map<string, Set<(event: TargetSnapshot<ApiJsonValue>) => void>>();

   function emit(event: TargetEvent) {
      for (const listener of targetListeners) listener(event);
   }

   function emitTarget(session: RemoteSession) {
      emit({ type: 'target-updated', target: session.target });
   }

   function updateTarget(session: RemoteSession, update: Partial<Target>) {
      session.target = { ...session.target, ...update };
      emitTarget(session);
      if (session.target.status !== 'ready') updateAttached(session, []);
   }

   function updateAttached(session: RemoteSession, hosted: readonly Target[]) {
      const previous = new Map(session.attached.map((target) => [target.id, target]));
      session.attached = hosted.map((target) => ({
         id: relayedTargetId(session.record.id, target.id),
         kind: target.kind,
         name: target.name,
         status: target.status,
         capabilities: target.capabilities,
         message: target.message,
         via: session.target.name
      }));

      for (const target of session.attached) {
         if (JSON.stringify(previous.get(target.id)) !== JSON.stringify(target)) emit({ type: 'target-updated', target });
         previous.delete(target.id);
      }
      for (const targetId of previous.keys()) emit({ type: 'target-removed', targetId });
   }

   function handleStreamEvent(session: RemoteSession, event: ReceiverStreamEvent) {
      if (event.type === 'heartbeat') return;

      if (event.type === 'target') {
         updateTarget(session, {
            status: event.target.status,
            capabilities: event.target.capabilities,
            message: event.target.message ?? (session.tokenPersisted ? undefined : insecureStorageMessage)
         });
         if (session.target.status === 'ready') updateAttached(session, event.attached);
         return;
      }

      if (!snapshots.get(event.namespace)?.safeParse(event.value).success) return;
      const targetId = event.targetId === undefined ? session.record.id : relayedTargetId(session.record.id, event.targetId);
      for (const listener of snapshotListeners.get(event.namespace) ?? []) {
         listener({ targetId, snapshot: event.value });
      }
   }

   function subscribe(listener: (event: TargetEvent) => void) {
      targetListeners.add(listener);
      return () => {
         targetListeners.delete(listener);
      };
   }

   function subscribeSnapshots(namespace: string, listener: (event: TargetSnapshot<ApiJsonValue>) => void) {
      const listeners = snapshotListeners.get(namespace) ?? new Set();
      listeners.add(listener);
      snapshotListeners.set(namespace, listeners);

      return () => {
         listeners.delete(listener);
         if (listeners.size === 0) snapshotListeners.delete(namespace);
      };
   }

   return { emit, emitTarget, updateTarget, updateAttached, handleStreamEvent, subscribe, subscribeSnapshots };
}

export type RemoteEvents = ReturnType<typeof createRemoteEvents>;
