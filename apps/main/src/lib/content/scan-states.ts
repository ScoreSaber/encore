import { readRecent } from '@/lib/content/content-cache';
import type { ContentScanCache } from '@/lib/content/content-cache';
import type { InstallId } from '@/modules/installs/contract';

export type ContentScanStatus = 'missing' | 'ready' | 'scanning' | 'unsupported';

const maxCachedInstallStates = 12;
const scanRefreshAfterMs = 60 * 1000;

export type ContentScanState<Snapshot, CacheEntry, Extra> = {
   installPath: string;
   snapshot: Snapshot;
   cache: Map<string, CacheEntry>;
   pending: Promise<Snapshot> | null;
   extra: Extra;
   refreshedAt: number;
   background: boolean;
};

type ScanStatesInput<Snapshot, CacheEntry, Extra> = {
   getInstallPath: (installId: InstallId) => Promise<string | null>;
   emptySnapshot: (installId: InstallId, status: ContentScanStatus) => Snapshot;
   emptyExtra: () => Extra;
   runScan: (input: { installId: InstallId; installPath: string; state: ContentScanState<Snapshot, CacheEntry, Extra> }) => Promise<Snapshot>;
   publish: (snapshot: Snapshot) => void;
   cache: ContentScanCache<Snapshot, CacheEntry, Extra>;
};

type InitializingScan<Snapshot> = {
   installPath: string;
   promise: Promise<Snapshot>;
   token: symbol;
};

export function createScanStates<Snapshot extends { status: ContentScanStatus }, CacheEntry, Extra>(
   input: ScanStatesInput<Snapshot, CacheEntry, Extra>
) {
   const states = new Map<InstallId, ContentScanState<Snapshot, CacheEntry, Extra>>();
   const initializing = new Map<InstallId, InitializingScan<Snapshot>>();

   async function list(installId: InstallId) {
      const installPath = await input.getInstallPath(installId);
      if (!installPath) return missing(installId);

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

   async function rescan(installId: InstallId) {
      const installPath = await input.getInstallPath(installId);
      if (!installPath) return missing(installId);

      const pending = initializing.get(installId);
      if (pending?.installPath === installPath) await pending.promise;
      else if (pending) initializing.delete(installId);

      const existing = readRecent(states, installId);
      if (existing?.installPath === installPath && existing.pending) return existing.pending;

      return scanResolved(installId, installPath, existing ?? null, false);
   }

   async function initialize(installId: InstallId, installPath: string, token: symbol): Promise<Snapshot> {
      const persisted = await input.cache.load(installId, installPath);
      if (initializing.get(installId)?.token !== token) return list(installId);
      if (!persisted) return scanResolved(installId, installPath, null, false);

      const state: ContentScanState<Snapshot, CacheEntry, Extra> = {
         installPath,
         snapshot: persisted.snapshot,
         cache: persisted.cache,
         pending: null,
         extra: persisted.extra,
         refreshedAt: 0,
         background: true
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
      const reusable = existing?.installPath === installPath ? existing : null;
      if (reusable?.pending) return reusable.pending;
      if (existing && !reusable) existing.background = true;

      const state: ContentScanState<Snapshot, CacheEntry, Extra> = {
         installPath,
         snapshot:
            background && reusable
               ? reusable.snapshot
               : { ...(reusable?.snapshot ?? input.emptySnapshot(installId, 'scanning')), status: 'scanning' },
         cache: reusable?.cache ?? new Map<string, CacheEntry>(),
         pending: null,
         extra: reusable?.extra ?? input.emptyExtra(),
         refreshedAt: reusable?.refreshedAt ?? 0,
         background
      };
      states.delete(installId);
      states.set(installId, state);
      if (!background) input.publish(state.snapshot);

      state.pending = input.runScan({ installId, installPath: state.installPath, state }).then(async (snapshot) => {
         if (states.get(installId) !== state) return snapshot;

         state.snapshot = snapshot;
         state.refreshedAt = Date.now();
         input.publish(snapshot);
         await input.cache.save(installId, state.installPath, state);

         return snapshot;
      });

      try {
         return await state.pending;
      } finally {
         state.pending = null;
         state.background = false;
         pruneStates();
      }
   }

   function missing(installId: InstallId) {
      const snapshot = input.emptySnapshot(installId, 'missing');
      const state = states.get(installId);
      if (state) state.background = true;
      states.delete(installId);
      initializing.delete(installId);
      void input.cache.remove(installId);
      input.publish(snapshot);
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
      states.clear();
      initializing.clear();
   }

   return { list, rescan, get, dispose };
}

export function pruneScanCache<Value>(cache: Map<string, Value>, seen: Set<string>) {
   for (const key of cache.keys()) {
      if (!seen.has(key)) cache.delete(key);
   }
}
