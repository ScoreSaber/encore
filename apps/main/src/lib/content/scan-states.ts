import { Result } from 'better-result';
import { z } from 'zod';

import { createPersistentCache, readRecent, type CacheLog } from '@/lib/content/content-cache';
import { createContentEvents } from '@/lib/events';
import type { InstallId } from '@/modules/installs/contract';

type ContentScanStatus = 'missing' | 'ready' | 'scanning' | 'unsupported';

type ScanProgress = { scanned: number; total: number };

const maxCachedInstallStates = 12;
const scanRefreshAfterMs = 60 * 1000;

type ScanMode = 'idle' | 'foreground' | 'background' | 'superseded';

type ContentScanState<Snapshot, CacheEntry, Extra> = {
   installPath: string;
   snapshot: Snapshot;
   cache: Map<string, CacheEntry>;
   pending: Promise<Snapshot> | null;
   extra: Extra;
   refreshedAt: number;
   mode: ScanMode;
};

type ScanStatesInput<Snapshot, CacheEntry, Extra> = {
   dataPath: string;
   log: CacheLog;
   cacheName: string;
   snapshotSchema: z.ZodType<Snapshot>;
   cacheEntrySchema: z.ZodType<CacheEntry>;
   extraSchema: z.ZodType<Extra>;
   emptyExtra: Extra;
   getInstallPath: (installId: InstallId) => Promise<string | null>;
   emptySnapshot: (installId: InstallId, status: ContentScanStatus) => Snapshot;
   runScan: (request: ScanRequest<Snapshot, CacheEntry, Extra>) => Promise<Snapshot>;
};

export type ScanRequest<Snapshot, CacheEntry, Extra> = {
   installId: InstallId;
   installPath: string;
   state: ContentScanState<Snapshot, CacheEntry, Extra>;
   onProgress: (progress: ScanProgress) => void;
};

type InitializingScan<Snapshot> = {
   installPath: string;
   promise: Promise<Snapshot>;
   token: symbol;
};

export function createScanStates<
   Snapshot extends { installId: InstallId; status: ContentScanStatus; progress: ScanProgress | null },
   CacheEntry,
   Extra
>(input: ScanStatesInput<Snapshot, CacheEntry, Extra>) {
   const states = new Map<InstallId, ContentScanState<Snapshot, CacheEntry, Extra>>();
   const initializing = new Map<InstallId, InitializingScan<Snapshot>>();
   const events = createContentEvents<Snapshot>();
   const cache = createScanCache(input);
   let disposed = false;

   async function listInstall(installId: InstallId) {
      if (disposed) return input.emptySnapshot(installId, 'missing');

      const installPath = await input.getInstallPath(installId);
      if (disposed || !installPath) return disposed ? input.emptySnapshot(installId, 'missing') : missing(installId);

      const state = readRecent(states, installId);
      if (state) {
         if (state.installPath !== installPath) return scanResolved(installId, installPath, state, false);
         if (!state.pending && Date.now() - state.refreshedAt >= scanRefreshAfterMs) void scanResolved(installId, state.installPath, state, true);

         return state.snapshot;
      }

      const pending = initializing.get(installId);
      if (pending?.installPath === installPath) return pending.promise;

      const token = Symbol();
      let entry: InitializingScan<Snapshot>;
      const started = initialize(installId, installPath, token).finally(() => {
         if (initializing.get(installId) === entry) initializing.delete(installId);
      });
      entry = { installPath, promise: started, token };
      initializing.set(installId, entry);

      return started;
   }

   async function rescan(request: { installId: InstallId }) {
      if (disposed) return input.emptySnapshot(request.installId, 'missing');

      const { installId } = request;
      const initialPath = await input.getInstallPath(installId);
      if (disposed) return input.emptySnapshot(installId, 'missing');
      if (!initialPath) return missing(installId);

      const pending = initializing.get(installId);
      if (pending?.installPath === initialPath) await pending.promise;
      else if (pending) initializing.delete(installId);

      const running = readRecent(states, installId);
      if (running?.installPath === initialPath && running.pending) await running.pending;
      if (disposed) return input.emptySnapshot(installId, 'missing');

      const currentPath = await input.getInstallPath(installId);
      if (disposed) return input.emptySnapshot(installId, 'missing');
      if (!currentPath) return missing(installId);

      return scanResolved(installId, currentPath, readRecent(states, installId) ?? null, false);
   }

   async function initialize(installId: InstallId, installPath: string, token: symbol): Promise<Snapshot> {
      const persisted = await cache.load(installPath);
      if (disposed) return input.emptySnapshot(installId, 'missing');
      if (initializing.get(installId)?.token !== token) return listInstall(installId);
      if (!persisted) return scanResolved(installId, installPath, null, false);

      const state: ContentScanState<Snapshot, CacheEntry, Extra> = {
         installPath,
         snapshot: { ...persisted.snapshot, installId },
         cache: persisted.cache,
         pending: null,
         extra: persisted.extra,
         refreshedAt: 0,
         mode: 'idle'
      };
      states.delete(installId);
      states.set(installId, state);
      void scanResolved(installId, installPath, state, true);

      return state.snapshot;
   }

   async function scanResolved(
      installId: InstallId,
      installPath: string,
      existing: ContentScanState<Snapshot, CacheEntry, Extra> | null,
      background: boolean
   ): Promise<Snapshot> {
      if (disposed) return input.emptySnapshot(installId, 'missing');

      const reusable = existing?.installPath === installPath ? existing : null;
      if (reusable?.pending) {
         if (!background && reusable.mode === 'background') {
            reusable.mode = 'foreground';
            reusable.snapshot = { ...reusable.snapshot, status: 'scanning' };
            events.publish(reusable.snapshot);
         }
         return reusable.pending;
      }
      if (existing && !reusable) existing.mode = 'superseded';

      const previousSnapshot = reusable?.snapshot ?? input.emptySnapshot(installId, 'scanning');
      const state: ContentScanState<Snapshot, CacheEntry, Extra> = {
         installPath,
         snapshot: background && reusable ? reusable.snapshot : { ...previousSnapshot, status: 'scanning' },
         cache: reusable?.cache ?? new Map<string, CacheEntry>(),
         pending: null,
         extra: reusable?.extra ?? input.emptyExtra,
         refreshedAt: reusable?.refreshedAt ?? 0,
         mode: background ? 'background' : 'foreground'
      };
      states.delete(installId);
      states.set(installId, state);
      if (state.mode === 'foreground') events.publish(state.snapshot);

      const onProgress = (progress: ScanProgress) => {
         if (disposed || state.mode !== 'foreground' || states.get(installId) !== state) return;

         state.snapshot = { ...state.snapshot, status: 'scanning', progress };
         events.publish(state.snapshot);
      };
      const pending = Result.tryPromise({
         try: () => input.runScan({ installId, installPath: state.installPath, state, onProgress }),
         catch: (cause) => cause
      }).then(async (ran) => {
         if (disposed || states.get(installId) !== state || state.mode === 'superseded') {
            return Result.isOk(ran) ? ran.value : previousSnapshot;
         }

         if (Result.isError(ran)) {
            state.snapshot = previousSnapshot;
            if (state.mode === 'foreground') events.publish(previousSnapshot);
            return previousSnapshot;
         }

         state.snapshot = ran.value;
         state.refreshedAt = Date.now();
         events.publish(ran.value);
         await cache.save(state.installPath, state);

         return ran.value;
      });
      state.pending = pending;

      try {
         return await pending;
      } finally {
         if (state.pending === pending) state.pending = null;
         if (state.mode !== 'superseded') state.mode = 'idle';
         pruneStates();
      }
   }

   function missing(installId: InstallId) {
      const snapshot = input.emptySnapshot(installId, 'missing');
      const state = states.get(installId);
      if (state) state.mode = 'superseded';
      states.delete(installId);
      initializing.delete(installId);
      events.publish(snapshot);
      return snapshot;
   }

   function pruneStates() {
      for (const [installId, state] of states) {
         if (states.size <= maxCachedInstallStates) return;
         if (!state.pending) states.delete(installId);
      }
   }

   function get(installId: InstallId) {
      return readRecent(states, installId);
   }

   function dispose() {
      disposed = true;
      for (const state of states.values()) state.mode = 'superseded';
      events.dispose();
      states.clear();
      initializing.clear();
   }

   return {
      list: ({ installId }: { installId: InstallId }) => listInstall(installId),
      rescan,
      get,
      publish: events.publish,
      subscribe: events.subscribe,
      dispose
   };
}

export function pruneScanCache<Value>(cache: Map<string, Value>, seen: Set<string>) {
   for (const key of cache.keys()) {
      if (!seen.has(key)) cache.delete(key);
   }
}

function createScanCache<Snapshot, CacheEntry, Extra>(options: {
   dataPath: string;
   log: CacheLog;
   cacheName: string;
   snapshotSchema: z.ZodType<Snapshot>;
   cacheEntrySchema: z.ZodType<CacheEntry>;
   extraSchema: z.ZodType<Extra>;
}) {
   const persistent = createPersistentCache({
      dataPath: options.dataPath,
      log: options.log,
      name: options.cacheName,
      valueSchema: z.object({
         snapshot: options.snapshotSchema,
         cache: z.array(z.tuple([z.string(), options.cacheEntrySchema])),
         extra: options.extraSchema
      })
   });

   async function load(installPath: string) {
      const stored = await persistent.get(installPath);
      if (!stored) return null;

      return { snapshot: stored.snapshot, cache: new Map(stored.cache), extra: stored.extra };
   }

   function save(installPath: string, state: { snapshot: Snapshot; cache: Map<string, CacheEntry>; extra: Extra }) {
      return persistent.set(installPath, { snapshot: state.snapshot, cache: [...state.cache.entries()], extra: state.extra });
   }

   return { load, save };
}
