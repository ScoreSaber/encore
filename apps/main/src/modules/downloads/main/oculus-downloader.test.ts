import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createOculusDownloader } from '@/modules/downloads/main/oculus-downloader';
import { createZipArchive } from '@/modules/downloads/main/oculus-manifest.fixture';
import { createVersionCatalog } from '@/modules/downloads/main/version-catalog';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitFor, waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';

const accessToken = 'FRLtestaccesstoken';
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('oculus downloader', () => {
   test('downloads the build into the install root and registers it', async () => {
      const harness = await createHarness();

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      const installPath = join(harness.installRoot, 'Beat Saber 1.37.0');
      expect(finished).toMatchObject({
         kind: 'download',
         status: 'completed',
         result: { store: 'oculus', name: '1.37.0', version: '1.37.0', path: installPath }
      });

      expect(await readFile(join(installPath, 'Beat Saber.exe'), 'utf8')).toBe(gameFiles['Beat Saber.exe']);
      expect(await readFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'latin1')).toBe(
         gameFiles['Beat Saber_Data/globalgamemanagers']
      );

      expect((await harness.registry.list()).installs).toMatchObject([
         { name: '1.37.0', status: 'ready', source: 'library', store: 'oculus', path: installPath }
      ]);
      expect((await readdir(installPath, { recursive: true })).some((name) => name.includes('.encore-oculus-'))).toBe(false);

      expect(JSON.stringify(harness.operations.list())).not.toContain(accessToken);
   });

   test('streams raw deflate segments without leaving staging files', async () => {
      const harness = await createHarness({ rawSegments: true });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      const installPath = join(harness.installRoot, 'Beat Saber 1.37.0');
      expect(finished).toMatchObject({ status: 'completed' });
      expect(await readFile(join(installPath, 'Beat Saber.exe'), 'utf8')).toBe(gameFiles['Beat Saber.exe']);
      expect((await readdir(installPath, { recursive: true })).some((name) => name.includes('.encore-oculus-'))).toBe(false);
   });

   test('cancels an oversized segment body and removes the partial install', async () => {
      const harness = await createHarness({ oversizedSegment: true });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      expect(finished).toMatchObject({ status: 'failed', error: { code: 'downloads.oculus.segment-failed' } });
      expect(harness.cancelledBodies()).toBeGreaterThan(0);
      expect(await readdir(harness.installRoot)).toEqual([]);
   });

   test('stops inflated segment output at the manifest file size', async () => {
      const harness = await createHarness({ undersizedFile: true });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      expect(finished).toMatchObject({ status: 'failed', error: { code: 'downloads.oculus.segment-failed' } });
      expect(await readdir(harness.installRoot)).toEqual([]);
   });

   test('refuses a build that does not match the published checksums', async () => {
      const harness = await createHarness({ corruptChecksum: true });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      expect(finished).toMatchObject({ status: 'failed', error: { code: 'downloads.oculus.integrity-failed' } });
      expect(JSON.stringify(finished)).not.toContain(accessToken);
      expect(await readdir(harness.installRoot)).toEqual([]);
   });

   test('cancelling leaves no partial install behind', async () => {
      const held = Promise.withResolvers<void>();
      const harness = await createHarness({ holdSegments: held.promise });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      await waitFor(() => harness.requestedUrls.length > 1, 'the download to start fetching segments');
      const cancelled = await harness.operations.cancel({ id: started.value.id });
      held.resolve();

      expect(cancelled).toMatchObject({ status: 'cancelled' });
      await waitFor(async () => (await readdir(harness.installRoot)).length === 0, 'the partial download to be discarded');
   });
});

const gameFiles = {
   'Beat Saber.exe': 'oculus beat saber binary',
   'Beat Saber_Data/globalgamemanagers': 'public.app-category.games  1.37.0 '
};

const publishedVersions = [
   {
      version: '1.29.1',
      manifestId: '2',
      oculusBinaryId: null,
      releaseUrl: null,
      releaseDate: '2023-01-01T00:00:00.000Z',
      year: '2023',
      recommended: false
   },
   {
      version: '1.37.0',
      manifestId: '3',
      oculusBinaryId: 'binary-1370',
      releaseUrl: null,
      releaseDate: '2024-01-01T00:00:00.000Z',
      year: '2024',
      recommended: false
   }
];

type HarnessOptions = {
   corruptChecksum?: boolean;
   holdSegments?: Promise<void>;
   oversizedSegment?: boolean;
   rawSegments?: boolean;
   undersizedFile?: boolean;
};

async function createHarness(options: HarnessOptions = {}) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-oculus-'));
   const installRoot = join(dataPath, 'library');
   await mkdir(installRoot, { recursive: true });

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   await settingsStore.updateLibrarySettings({ installRoot });

   const detectStores = (): Promise<StoreDetectionSnapshot> =>
      Promise.resolve({
         targetId: 'local',
         platform: 'linux',
         scannedAt: new Date().toISOString(),
         stores: [],
         candidates: [],
         diagnostics: []
      });

   const registry = createInstallRegistry({ dataPath, settingsStore, detectStores });
   const operations = createOperationRegistry();
   const catalog = createVersionCatalog({
      dataPath,
      sourceUrl: 'https://versions.test/bs-versions.json',
      fetchCatalog: () => Promise.resolve(Response.json(publishedVersions))
   });

   const { archive, segments } = createBinary(options);
   const requestedUrls: string[] = [];
   let cancelledBodies = 0;

   const downloader = createOculusDownloader({
      settingsStore,
      registry,
      operations,
      catalog,
      platform: 'win32',
      requestToken: () => Promise.resolve(Result.ok(accessToken)),
      maxAttempts: 1,
      concurrency: 1,
      fetchBinary: async (url, init) => {
         requestedUrls.push(url);
         const query = new URL(url).searchParams;
         expect(query.get('access_token')).toBe(accessToken);

         if (query.get('get_manifest') === '1') return new Response(toArrayBuffer(archive));

         if (options.holdSegments) await waitForRelease(options.holdSegments, init.signal);

         const segment = segments.get(query.get('segment_sha256') ?? '');
         if (segment && options.oversizedSegment) {
            return new Response(
               new ReadableStream<Uint8Array>({
                  start(controller) {
                     controller.enqueue(segment);
                     controller.enqueue(Uint8Array.of(0));
                  },
                  cancel() {
                     cancelledBodies += 1;
                  }
               })
            );
         }

         return segment ? new Response(toArrayBuffer(segment)) : new Response('missing', { status: 404 });
      }
   });

   cleanups.push(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return { installRoot, registry, operations, downloader, requestedUrls, cancelledBodies: () => cancelledBodies };
}

function createBinary(options: HarnessOptions) {
   const segments = new Map<string, Buffer>();
   const files: Record<string, { sha256: string; size: number; segments: [number, string, number][] }> = {};

   for (const [name, content] of Object.entries(gameFiles)) {
      const payload = Buffer.from(content, 'latin1');
      const halves = [payload.subarray(0, Math.ceil(payload.length / 2)), payload.subarray(Math.ceil(payload.length / 2))];

      files[name] = {
         sha256: options.corruptChecksum ? 'deadbeef' : createHash('sha256').update(payload).digest('hex'),
         size: options.undersizedFile ? payload.length - 1 : payload.length,
         segments: halves.map((half, index) => {
            const compressed = options.rawSegments ? deflateRawSync(half) : deflateSync(half);
            const sha256 = createHash('sha256').update(compressed).digest('hex');
            segments.set(sha256, compressed);

            return [index, sha256, compressed.length];
         })
      };
   }

   return { archive: createZipArchive([{ name: 'manifest.json', content: Buffer.from(JSON.stringify({ files }), 'utf8') }]), segments };
}

async function waitForRelease(release: Promise<void>, signal: AbortSignal) {
   await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      void release.then(resolve);
   });
}

function toArrayBuffer(payload: Buffer) {
   return Uint8Array.from(payload).buffer;
}
