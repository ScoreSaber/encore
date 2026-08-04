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

export function createScanStates<Snapshot extends { status: ContentScanStatus }, CacheEntry, Extra>(
   input: ScanStatesInput<Snapshot, CacheEntry, Extra>
) {
   const states = new Map<InstallId, ContentScanState<Snapshot, CacheEntry, Extra>>();
   const initializing = new Map<InstallId, Promise<Snapshot>>();

   async function list(installId: InstallId) {
      const state = readRecent(states, installId);
      if (state) {
         if (!state.pending && Date.now() - state.refreshedAt >= scanRefreshAfterMs) void scanResolved(installId, state.installPath, state, true);

         return state.snapshot;
      }

      const pending = initializing.get(installId);
      if (pending) return pending;

      const started = initialize(installId).finally(() => {
         initializing.delete(installId);
      });
      initializing.set(installId, started);

      return started;
   }

   async function rescan(installId: InstallId) {
      const pending = initializing.get(installId);
      if (pending) await pending;

      const existing = readRecent(states, installId);
      if (existing?.pending) return existing.pending;

      const installPath = await input.getInstallPath(installId);
      if (!installPath) return missing(installId);

      return scanResolved(installId, installPath, existing ?? null, false);
   }

   async function initialize(installId: InstallId): Promise<Snapshot> {
      const installPath = await input.getInstallPath(installId);
      if (!installPath) return missing(installId);

      const persisted = await input.cache.load(installId, installPath);
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
      if (existing?.pending) return existing.pending;

      const state: ContentScanState<Snapshot, CacheEntry, Extra> = {
         installPath,
         snapshot:
            background && existing
               ? existing.snapshot
               : { ...(existing?.snapshot ?? input.emptySnapshot(installId, 'scanning')), status: 'scanning' },
         cache: existing && existing.installPath === installPath ? existing.cache : new Map(),
         pending: null,
         extra: existing && existing.installPath === installPath ? existing.extra : input.emptyExtra(),
         refreshedAt: existing?.refreshedAt ?? 0,
         background
      };
      states.delete(installId);
      states.set(installId, state);
      if (!background) input.publish(state.snapshot);

      state.pending = input.runScan({ installId, installPath: state.installPath, state }).then((snapshot) => {
         state.snapshot = snapshot;
         state.refreshedAt = Date.now();
         input.publish(snapshot);
         void input.cache.save(installId, state.installPath, state);

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
      states.delete(installId);
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
