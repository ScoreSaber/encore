import { Result } from 'better-result';

import { createSteamDownloader } from '@/modules/downloads/main/steam-downloader';
import { createVersionCatalog } from '@/modules/downloads/main/version-catalog';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitFor, waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('steam downloader', () => {
   test('downloads alongside existing depot content and leaves it in place', async () => {
      const harness = await createHarness();

      await mkdir(join(harness.depotPath, 'Beat Saber_Data'), { recursive: true });
      await writeFile(join(harness.depotPath, 'leftover.bin'), 'stale', 'utf8');

      expect(await harness.downloader.preview('1.37.0')).toMatchObject({
         status: 'ok',
         warnings: ['steam-console-opens', 'depot-not-empty']
      });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ status: 'completed' });
      expect((await readdir(harness.depotPath)).sort()).toEqual(['Beat Saber_Data', 'leftover.bin']);
      expect(await readdir(join(harness.installRoot, 'Beat Saber 1.37.0'))).toContain('leftover.bin');
   });

   test('copies a settled depot into the install root and registers it', async () => {
      const harness = await createHarness();

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      expect(finished).toMatchObject({
         kind: 'download',
         status: 'completed',
         result: { name: '1.37.0', version: '1.37.0', path: join(harness.installRoot, 'Beat Saber 1.37.0') }
      });
      expect(harness.launches).toEqual([{ executablePath: harness.steamExecutable, manifestId: '3' }]);

      const installed = (await harness.registry.list()).installs;
      expect(installed).toMatchObject([
         {
            name: '1.37.0',
            version: '1.37.0',
            status: 'ready',
            source: 'library',
            store: 'steam',
            path: join(harness.installRoot, 'Beat Saber 1.37.0')
         }
      ]);
      expect(await readdir(harness.depotPath)).toEqual([]);
   });

   test('uses an existing depot when it already contains the requested version', async () => {
      const harness = await createHarness({ launchWrites: false });
      await writeDepotContent(harness.depotPath);

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ status: 'completed' });
      expect(await readdir(join(harness.installRoot, 'Beat Saber 1.37.0'))).toContain('Beat Saber.exe');
      expect(await readdir(harness.depotPath)).toContain('Beat Saber.exe');
   });

   test('cancelling leaves no partial install and never kills Steam', async () => {
      const harness = await createHarness({ settleMs: 5_000 });

      const started = await harness.downloader.start('1.37.0');
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      await waitFor(() => harness.launches.length === 1, 'the Steam client to be launched');
      const cancelled = await harness.operations.cancel({ id: started.value.id });

      expect(cancelled).toMatchObject({ status: 'cancelled' });
      expect(await readdir(harness.installRoot)).toEqual([]);
      expect(await readdir(harness.depotPath)).toContain('Beat Saber.exe');
   });
});

const publishedVersions = [
   {
      version: '1.37.0',
      manifestId: '3',
      oculusBinaryId: null,
      releaseUrl: null,
      releaseDate: '2024-01-01T00:00:00.000Z',
      year: '2024',
      recommended: false
   }
];

async function createHarness(options: { settleMs?: number; launchWrites?: boolean } = {}) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-download-'));
   const installRoot = join(dataPath, 'library');
   const steamRoot = join(dataPath, 'steam');
   const depotPath = join(steamRoot, 'steamapps', 'content', 'app_620980', 'depot_620981');
   const steamExecutable = join(steamRoot, 'steam.exe');
   await mkdir(installRoot, { recursive: true });
   await mkdir(depotPath, { recursive: true });

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

   const launches: { executablePath: string; manifestId: string }[] = [];
   const downloader = createSteamDownloader({
      settingsStore,
      registry,
      operations,
      catalog,
      readClientState: () => Promise.resolve({ status: 'ready', root: steamRoot, executablePath: steamExecutable, depotPath }),
      launch: async (input) => {
         launches.push(input);
         if (options.launchWrites !== false) await writeDepotContent(depotPath);

         return Result.ok<void, string>(undefined);
      },
      pollIntervalMs: 10,
      settleMs: options.settleMs ?? 40,
      firstBytesTimeoutMs: 200,
      timeoutMs: 5_000
   });

   cleanups.push(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return { installRoot, depotPath, steamExecutable, registry, operations, downloader, launches };
}

async function writeDepotContent(depotPath: string) {
   await mkdir(join(depotPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(depotPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(depotPath, 'UnityPlayer.dll'), 'stub', 'utf8');
   await writeFile(join(depotPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');
}
