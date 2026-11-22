import { afterEach, expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';

import { createScanStates } from '@/lib/content/scan-states';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type TestSnapshot = {
   installId: string;
   status: 'missing' | 'ready' | 'scanning' | 'unsupported';
   progress: { scanned: number; total: number } | null;
   items: string[];
};

const snapshotSchema: z.ZodType<TestSnapshot> = z.object({
   installId: z.string(),
   status: z.enum(['missing', 'ready', 'scanning', 'unsupported']),
   progress: z.object({ scanned: z.number(), total: z.number() }).nullable(),
   items: z.array(z.string())
});

const tempDirs: string[] = [];

afterEach(async () => {
   while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
   }
});

async function createTempDir() {
   const dir = await mkdtemp(join(tmpdir(), 'encore-scan-states-'));
   tempDirs.push(dir);
   return dir;
}

const silentLog = { warn: () => undefined };

test('background refresh preserves cached ready status and foreground rescan restores previous snapshot on failure', async () => {
   const dataPath = await createTempDir();
   const installPath = join(dataPath, 'install-a');

   const primer = createScanStates({
      dataPath,
      log: silentLog,
      cacheName: 'test-scan',
      snapshotSchema,
      cacheEntrySchema: z.string(),
      extraSchema: z.null(),
      emptyExtra: null,
      getInstallPath: async () => installPath,
      emptySnapshot: (installId, status) => ({ installId, status, progress: null, items: [] }),
      runScan: async ({ installId }) => ({ installId, status: 'ready', progress: null, items: ['cached-item'] })
   });
   expect((await primer.list({ installId: 'inst-1' })).items).toEqual(['cached-item']);
   primer.dispose();

   const bgGate = Promise.withResolvers<TestSnapshot>();
   let failNext = false;
   const runScan = vi.fn(async ({ onProgress }: { onProgress: (p: { scanned: number; total: number }) => void }) => {
      onProgress({ scanned: 1, total: 2 });
      if (failNext) throw new Error('disk offline');
      return bgGate.promise;
   });

   const scanner = createScanStates({
      dataPath,
      log: silentLog,
      cacheName: 'test-scan',
      snapshotSchema,
      cacheEntrySchema: z.string(),
      extraSchema: z.null(),
      emptyExtra: null,
      getInstallPath: async () => installPath,
      emptySnapshot: (installId, status) => ({ installId, status, progress: null, items: [] }),
      runScan
   });
   const published: TestSnapshot[] = [];
   scanner.subscribe((snapshot) => published.push(snapshot));

   const initial = await scanner.list({ installId: 'inst-1' });
   expect(initial).toMatchObject({ status: 'ready', items: ['cached-item'] });
   expect(published).toEqual([]);

   bgGate.resolve({ installId: 'inst-1', status: 'ready', progress: null, items: ['fresh-item'] });
   await vi.waitFor(() => expect(published).toContainEqual(expect.objectContaining({ status: 'ready', items: ['fresh-item'] })));

   published.length = 0;
   failNext = true;
   const recovered = await scanner.rescan({ installId: 'inst-1' });
   expect(recovered).toMatchObject({ status: 'ready', items: ['fresh-item'] });
   expect(published.at(0)?.status).toBe('scanning');
   expect(published.at(-1)).toMatchObject({ status: 'ready', items: ['fresh-item'] });
   scanner.dispose();
});

test('dispose stops post-dispose scans and discards in-flight scan emissions', async () => {
   const dataPath = await createTempDir();
   const gate = Promise.withResolvers<TestSnapshot>();
   const scanner = createScanStates({
      dataPath,
      log: silentLog,
      cacheName: 'test-dispose',
      snapshotSchema,
      cacheEntrySchema: z.string(),
      extraSchema: z.null(),
      emptyExtra: null,
      getInstallPath: async () => join(dataPath, 'install-b'),
      emptySnapshot: (installId, status) => ({ installId, status, progress: null, items: [] }),
      runScan: async () => gate.promise
   });
   const published: TestSnapshot[] = [];
   scanner.subscribe((snapshot) => published.push(snapshot));

   const pending = scanner.list({ installId: 'inst-2' });
   await vi.waitFor(() => expect(published).toHaveLength(1));
   scanner.dispose();
   gate.resolve({ installId: 'inst-2', status: 'ready', progress: null, items: ['late'] });
   await pending;

   expect(published).toHaveLength(1);
   expect(await scanner.list({ installId: 'inst-2' })).toMatchObject({ status: 'missing' });
   expect(await scanner.rescan({ installId: 'inst-2' })).toMatchObject({ status: 'missing' });
});
