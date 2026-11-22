import { Result } from 'better-result';
import { z } from 'zod';

import type { Problem } from '@/lib/errors';
import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { createSerialQueue } from '@/lib/state/machine';
import type { QuestTarget } from '@/modules/quest/main/quest-target';
import type { RemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { isQuestTargetId, type Target, type TargetConnection, type TargetEvent, type TargetId } from '@/modules/targets/contract';

import { join } from 'node:path';

const knownHeadsetSchema = z.object({
   targetId: z.string().refine(isQuestTargetId),
   name: z.string().min(1).max(200),
   connection: z.enum(['usb', 'wifi', 'remote']),
   via: z.string().max(200).optional(),
   endpoint: z.string().max(300).optional()
});
const storeSchema = z.object({
   known: z.array(knownHeadsetSchema).max(64),
   forgotten: z.array(z.string().refine(isQuestTargetId)).max(64)
});
type KnownHeadset = z.infer<typeof knownHeadsetSchema>;

const reconnectIntervalMs = 30_000;
const acceptWindowMs = 2 * 60_000;
const connectionRank = { remote: 3, usb: 2, wifi: 1 };

type Route = { targetId: TargetId; local: boolean };
type Candidate = { target: Target; route: Route; connection: TargetConnection };

export type QuestHeadsets = ReturnType<typeof createQuestHeadsets>;

type HeadsetsLifecycle = 'hydrating' | 'ready' | 'disposed';

export function createQuestHeadsets(options: {
   dataPath: string;
   local: Pick<QuestTarget, 'listTargets' | 'subscribe'>;
   remote: Pick<RemoteReceiverClient, 'listTargets' | 'subscribe'>;
   reconnect: (endpoint: string) => Promise<void>;
   disableWireless: (targetId: TargetId) => Promise<Result<unknown, Problem>>;
}) {
   const storePath = join(options.dataPath, 'quest-headsets.json');
   const writeQueue = createSerialQueue();
   let known: KnownHeadset[] = [];
   let lifecycle: HeadsetsLifecycle = 'hydrating';
   const isDisposed = () => lifecycle === 'disposed';
   let forgotten = new Set<TargetId>();
   const forgivenBeforeLoad = new Set<TargetId>();
   let pluggedIn = new Set<TargetId>();
   let acceptUntil = 0;
   const held = new Set<TargetId>();
   const listeners = new Set<(event: TargetEvent) => void>();
   let merged = new Map<TargetId, { target: Target; route: Route | null }>();
   let retrying: Promise<void[]> | null = null;

   function hostedId(targetId: TargetId) {
      const hosted = targetId.slice(targetId.lastIndexOf('/') + 1);
      return isQuestTargetId(hosted) ? hosted : null;
   }

   function candidates() {
      const found = new Map<TargetId, Candidate[]>();
      const add = (id: TargetId, candidate: Candidate) => found.set(id, [...(found.get(id) ?? []), candidate]);
      for (const target of options.local.listTargets()) {
         add(target.id, { target, route: { targetId: target.id, local: true }, connection: target.address ? 'wifi' : 'usb' });
      }
      for (const target of options.remote.listTargets()) {
         const id = target.kind === 'quest' ? hostedId(target.id) : null;
         if (id) add(id, { target, route: { targetId: target.id, local: false }, connection: 'remote' });
      }
      return found;
   }

   function rank(candidate: Candidate) {
      return (candidate.target.status === 'ready' ? 10 : 0) + connectionRank[candidate.connection];
   }

   function compute() {
      const next = new Map<TargetId, { target: Target; route: Route | null }>();
      for (const [id, found] of candidates()) {
         if (forgotten.has(id)) continue;
         const best = [...found].sort((first, second) => rank(second) - rank(first))[0];
         if (!best) continue;
         const name =
            best.target.status === 'ready' ? best.target.name : (known.find((headset) => headset.targetId === id)?.name ?? best.target.name);
         next.set(id, {
            target: { ...best.target, id, name, connection: best.connection, via: best.connection === 'remote' ? best.target.via : undefined },
            route: best.route
         });
      }
      for (const headset of known) {
         if (next.has(headset.targetId) || forgotten.has(headset.targetId)) continue;
         next.set(headset.targetId, {
            target: {
               id: headset.targetId,
               kind: 'quest',
               name: headset.name,
               status: 'disconnected',
               capabilities: [],
               connection: headset.connection,
               via: headset.via
            },
            route: null
         });
      }
      return next;
   }

   async function remember(targets: Target[]) {
      if (lifecycle !== 'ready') return;
      let changed = false;
      for (const target of targets) {
         if (target.status !== 'ready' || !target.connection) continue;
         const endpoint = target.connection === 'wifi' && target.address && /:\d+$/.test(target.address) ? target.address : undefined;
         const previous = known.find((headset) => headset.targetId === target.id);
         const record: KnownHeadset = {
            targetId: target.id,
            name: target.name,
            connection: target.connection,
            via: target.via,
            endpoint: endpoint ?? previous?.endpoint
         };
         if (previous && JSON.stringify(previous) === JSON.stringify(record)) continue;
         known = [...known.filter((headset) => headset.targetId !== target.id), record].slice(-64);
         changed = true;
      }
      if (changed) await save();
   }

   function save() {
      return writeQueue.run(() =>
         writeJsonFileAtomic(storePath, { known: [...known], forgotten: [...forgotten] }, storeSchema, { root: options.dataPath })
      );
   }

   function forgive() {
      const accepting = Date.now() < acceptUntil;
      const found = candidates();
      const usb = new Set(
         [...found].flatMap(([id, routes]) => (routes.some((candidate) => candidate.route.local && candidate.connection === 'usb') ? [id] : []))
      );
      const returned = [...forgotten].filter(
         (id) => (usb.has(id) && !pluggedIn.has(id)) || (accepting && found.get(id)?.some((candidate) => candidate.target.status === 'ready'))
      );
      pluggedIn = usb;
      if (returned.length === 0) return;
      forgotten = new Set([...forgotten].filter((id) => !returned.includes(id)));
      if (lifecycle === 'hydrating') {
         for (const id of returned) forgivenBeforeLoad.add(id);
      } else if (lifecycle === 'ready') {
         void save();
      }
   }

   function update() {
      if (isDisposed()) return;
      forgive();
      const next = compute();
      for (const id of held) if (next.get(id)?.target.status === 'ready') held.delete(id);
      const previous = merged;
      merged = next;
      for (const [id, entry] of next) {
         if (JSON.stringify(previous.get(id)?.target) !== JSON.stringify(entry.target)) emit({ type: 'target-updated', target: entry.target });
      }
      for (const id of previous.keys()) if (!next.has(id)) emit({ type: 'target-removed', targetId: id });
      void remember([...next.values()].map((entry) => entry.target));
   }

   function emit(event: TargetEvent) {
      for (const listener of listeners) listener(event);
   }

   const isRelayedQuest = (event: TargetEvent) =>
      event.type === 'target-updated' ? event.target.kind === 'quest' : event.targetId.includes('/') && hostedId(event.targetId) !== null;

   const unsubscribeLocal = options.local.subscribe(update);
   const unsubscribeRemote = options.remote.subscribe((event) => {
      if (isRelayedQuest(event)) update();
   });
   merged = compute();
   const restored = readJsonFileOrDefault(storePath, storeSchema, { defaultValue: { known: [], forgotten: [] } }).then((stored) => {
      if (isDisposed()) return;
      known = stored.known;
      forgotten = new Set([...stored.forgotten.filter((id) => !forgivenBeforeLoad.has(id)), ...forgotten]);
      forgivenBeforeLoad.clear();
      lifecycle = 'ready';
      update();
   });

   const retry = () => {
      if (isDisposed()) return Promise.resolve([]);
      if (retrying) return retrying;

      const run = Promise.all(
         known.flatMap((headset) =>
            headset.endpoint && !held.has(headset.targetId) && merged.get(headset.targetId)?.route === null
               ? [options.reconnect(headset.endpoint)]
               : []
         )
      ).finally(() => {
         if (retrying === run) retrying = null;
      });
      retrying = run;
      return run;
   };
   const reconnecting = setInterval(() => void retry(), reconnectIntervalMs);

   return {
      listTargets: () => [...merged.values()].map((entry) => entry.target),
      knowsLocalHeadset: async () => {
         await restored;
         return known.some((headset) => headset.connection !== 'remote');
      },
      route: (targetId: TargetId) => merged.get(targetId)?.route ?? null,
      headsetFor(routeTargetId: TargetId) {
         const id = hostedId(routeTargetId);
         return id && merged.get(id)?.route?.targetId === routeTargetId ? id : null;
      },
      isRelayedQuest,
      retry,
      async forget(targetId: TargetId) {
         await restored;
         const current = merged.get(targetId);
         if (current?.route?.local && current.target.connection === 'wifi' && current.target.status === 'ready') {
            const disabled = await options.disableWireless(current.route.targetId);
            if (Result.isError(disabled)) return Result.err(disabled.error);
         }
         forgotten.add(targetId);
         acceptUntil = 0;
         known = known.filter((headset) => headset.targetId !== targetId);
         const written = await save();
         update();
         return Result.map(written, () => undefined);
      },
      hold: (targetId: TargetId) => {
         held.add(targetId);
      },
      unhold: (targetId: TargetId) => {
         held.delete(targetId);
      },
      accept() {
         acceptUntil = Date.now() + acceptWindowMs;
         update();
      },
      subscribe(listener: (event: TargetEvent) => void) {
         listeners.add(listener);
         return () => listeners.delete(listener);
      },
      dispose() {
         lifecycle = 'disposed';
         clearInterval(reconnecting);
         unsubscribeLocal();
         unsubscribeRemote();
         listeners.clear();
      }
   };
}
