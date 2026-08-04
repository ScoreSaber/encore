import type { ContentScanCache } from '@/lib/content/content-cache';
import { createScanStates } from '@/lib/content/scan-states';

import { describe, expect, test } from 'bun:test';

type Snapshot = { status: 'missing' | 'ready' | 'scanning'; value: number };

const emptyCache: ContentScanCache<Snapshot, string, null> = {
   load: async () => null,
   save: async () => undefined,
   remove: async () => undefined
};

describe('content scan states', () => {
   test('reuses the scan cache across rescans', async () => {
      let scans = 0;
      const states = createScanStates<Snapshot, string, null>({
         getInstallPath: async () => '/game',
         emptySnapshot: (_installId, status) => ({ status: status === 'unsupported' ? 'missing' : status, value: 0 }),
         emptyExtra: () => null,
         runScan: async ({ state }) => {
            scans += 1;
            expect(state.cache.get('map')).toBe(scans === 1 ? undefined : 'parsed');
            if (scans === 1) state.cache.set('map', 'parsed');
            state.snapshot = { status: 'ready', value: scans };
            return state.snapshot;
         },
         publish: () => undefined,
         cache: emptyCache
      });

      await states.list('install');
      const rescanned = await states.rescan('install');

      expect(rescanned).toEqual({ status: 'ready', value: 2 });
   });

   test('evicts old idle install state', async () => {
      const states = createScanStates<Snapshot, string, null>({
         getInstallPath: async (installId) => `/game/${installId}`,
         emptySnapshot: (_installId, status) => ({ status: status === 'unsupported' ? 'missing' : status, value: 0 }),
         emptyExtra: () => null,
         runScan: async ({ state }) => {
            state.snapshot = { status: 'ready', value: 1 };
            return state.snapshot;
         },
         publish: () => undefined,
         cache: emptyCache
      });

      for (let index = 0; index < 13; index += 1) {
         await states.list(`install-${index}`);
      }

      expect(states.get('install-0')).toBeUndefined();
      expect(states.get('install-12')?.snapshot.status).toBe('ready');
   });

   test('returns a persisted snapshot while revalidating it in the background', async () => {
      const { promise: scanGate, resolve: finishScan } = Promise.withResolvers<void>();
      const saved: Snapshot[] = [];
      const published: Snapshot[] = [];
      const states = createScanStates<Snapshot, string, null>({
         getInstallPath: async () => '/game',
         emptySnapshot: (_installId, status) => ({ status: status === 'unsupported' ? 'missing' : status, value: 0 }),
         emptyExtra: () => null,
         runScan: async ({ state }) => {
            expect(state.background).toBe(true);
            await scanGate;
            return { status: 'ready', value: 2 };
         },
         publish: (snapshot) => published.push(snapshot),
         cache: {
            load: async () => ({ snapshot: { status: 'ready', value: 1 }, cache: new Map([['map', 'parsed']]), extra: null }),
            save: async (_installId, _installPath, state) => {
               saved.push(state.snapshot);
            },
            remove: async () => undefined
         }
      });

      const listed = await states.list('install');

      expect(listed).toEqual({ status: 'ready', value: 1 });
      expect(published).toEqual([]);
      expect(states.get('install')?.cache.get('map')).toBe('parsed');

      const pending = states.get('install')?.pending;
      finishScan();
      await pending;

      expect(published).toEqual([{ status: 'ready', value: 2 }]);
      expect(saved).toEqual([{ status: 'ready', value: 2 }]);
   });
});
