import { Result } from 'better-result';

import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { buildZipArchive } from '@/lib/content/zip-archive.fixture';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import type { ModOperationResult } from '@/modules/mods/contract';
import { createBeatModsApi, beatModsDownloadUrl } from '@/modules/mods/main/beatmods-api';
import { createModCatalogService } from '@/modules/mods/main/mod-catalog';
import { createModPatcher, type ModPatcherRun } from '@/modules/mods/main/mod-patcher';
import { createModService } from '@/modules/mods/main/mod-service';
import type { OperationError } from '@/modules/operations/contract';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('mod service', () => {
   test('hydrates the last per-install snapshot before touching the catalog', async () => {
      const harness = await createHarness();
      expect(await harness.mods.refreshMods(harness.request)).toMatchObject({ status: 'ready', source: 'remote' });

      const restored = createModService({
         registry: harness.registry,
         operations: harness.operations,
         dataPath: harness.dataPath,
         ingestion: createContentIngestionService({ dataPath: harness.dataPath, fetchContent: fakeCdn }),
         catalog: createModCatalogService({
            dataPath: harness.dataPath,
            api: createBeatModsApi({ fetchJson: () => Promise.resolve(new Response('offline', { status: 503 })) })
         })
      });

      expect(await restored.getMods(harness.request)).toMatchObject({ status: 'ready', source: 'cache', gameVersion: '1.37.0' });
   });

   test('installs the dependency chain and removes only files the selected mod owns', async () => {
      const harness = await createHarness();
      const request = { ...harness.request, modIds: ['beatmods:3'] };

      expect(await harness.mods.previewInstall(request)).toMatchObject({
         status: 'ok',
         warnings: ['bsipa-first', 'patcher-runs']
      });
      expect(await harness.run(await harness.mods.installMods(request))).toMatchObject({
         status: 'completed',
         result: { mods: 3, files: 4 }
      });
      expect(await readFile(join(harness.installPath, 'IPA.exe'), 'utf8')).toBe('ipa-exe');
      expect(await readFile(join(harness.installPath, 'IPA', 'Pending', 'Plugins', 'BSML.dll'), 'utf8')).toBe('bsml');
      expect(await readFile(join(harness.installPath, 'IPA', 'Pending', 'Plugins', 'Counters.dll'), 'utf8')).toBe('counters');
      expect(harness.patcherRuns).toEqual([[join(harness.installPath, 'Beat Saber.exe'), '-n']]);

      await mkdir(join(harness.installPath, 'Plugins'), { recursive: true });
      await writeFile(join(harness.installPath, 'Plugins', 'Handmade.dll'), 'handmade', 'utf8');

      expect(await harness.run(await harness.mods.uninstallMods({ ...harness.request, scope: 'selection', modIds: ['beatmods:2'] }))).toMatchObject({
         status: 'completed',
         result: { mods: 1, files: 1 }
      });
      expect(await readdir(join(harness.installPath, 'IPA', 'Pending', 'Plugins'))).toEqual(['Counters.dll']);
      expect(await readFile(join(harness.installPath, 'Plugins', 'Handmade.dll'), 'utf8')).toBe('handmade');
      expect(await readFile(join(harness.installPath, 'IPA.exe'), 'utf8')).toBe('ipa-exe');
   });

   test('refuses a mod archive whose files do not match the hashes BeatMods published', async () => {
      const harness = await createHarness();

      const finished = await harness.run(await harness.mods.installMods({ ...harness.request, modIds: ['beatmods:4'] }));

      expect(finished).toMatchObject({ status: 'failed', error: { code: 'content.extract.checksum-mismatch' } });
      expect(await readdir(harness.installPath)).not.toContain('IPA');
   });

   test('uninstall all reverts BSIPA and clears the mod folders', async () => {
      const harness = await createHarness();
      await harness.run(await harness.mods.installMods({ ...harness.request, modIds: ['beatmods:3'] }));
      await mkdir(join(harness.installPath, 'Plugins'), { recursive: true });
      await writeFile(join(harness.installPath, 'Plugins', 'Handmade.dll'), 'handmade', 'utf8');

      expect(await harness.mods.previewUninstall({ ...harness.request, scope: 'all', modIds: [] })).toMatchObject({
         status: 'ok',
         warnings: ['removes-external', 'patcher-runs']
      });
      expect(await harness.run(await harness.mods.uninstallMods({ ...harness.request, scope: 'all', modIds: [] }))).toMatchObject({
         status: 'completed'
      });
      expect(harness.patcherRuns.at(-1)).toEqual([join(harness.installPath, 'Beat Saber.exe'), '--revert', '-n']);

      const remaining = await readdir(harness.installPath);
      expect(remaining).not.toContain('IPA');
      expect(remaining).not.toContain('Plugins');
      expect(remaining).toContain('Beat Saber.exe');
   });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-mods-'));
   const installRoot = join(dataPath, 'library');
   const installPath = await createInstall(installRoot);
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
   const patcherRuns: string[][] = [];
   const run: ModPatcherRun = async (input) => {
      patcherRuns.push(input.args);
      const injectorPath = join(input.cwd, 'Beat Saber_Data', 'Managed', 'IPA.Injector.dll');

      if (input.args.includes('--revert')) {
         await rm(injectorPath, { force: true });
         await rm(join(input.cwd, 'winhttp.dll'), { force: true });
      } else {
         await mkdir(join(input.cwd, 'Beat Saber_Data', 'Managed'), { recursive: true });
         await writeFile(injectorPath, 'injector', 'utf8');
         await writeFile(join(input.cwd, 'winhttp.dll'), 'loader', 'utf8');
      }

      return Result.ok<void, OperationError>(undefined);
   };
   const mods = createModService({
      registry,
      operations,
      dataPath,
      ingestion: createContentIngestionService({ dataPath, fetchContent: fakeCdn }),
      catalog: createModCatalogService({ dataPath, api: createBeatModsApi({ fetchJson: fakeBeatMods }) }),
      patcher: createModPatcher({ platform: 'win32', run })
   });

   cleanups.push(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   const registered = await registry.register({ source: 'library', path: installPath });
   if (Result.isError(registered)) throw new Error('registration failed');

   return {
      dataPath,
      installPath,
      mods,
      operations,
      patcherRuns,
      registry,
      request: { targetId: 'local', installId: registered.value.id },
      run: (started: ModOperationResult) => {
         if (!started.ok) throw new Error('the mod operation did not start');

         return waitForOperation(operations, started.value.id);
      }
   };
}

async function createInstall(parentPath: string) {
   const installPath = join(parentPath, 'Beat Saber');
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');

   return installPath;
}

const modZips = {
   bsipa: buildZipArchive([
      { name: 'IPA.exe', data: 'ipa-exe' },
      { name: 'IPA/Data/Managed/IPA.Injector.dll', data: 'injector' }
   ]),
   bsml: buildZipArchive([{ name: 'Plugins/BSML.dll', data: 'bsml' }]),
   counters: buildZipArchive([{ name: 'Plugins/Counters.dll', data: 'counters' }]),
   broken: buildZipArchive([{ name: 'Plugins/Broken.dll', data: 'tampered' }])
};

const zipHashes = {
   bsipa: md5(modZips.bsipa),
   bsml: md5(modZips.bsml),
   counters: md5(modZips.counters),
   broken: md5(modZips.broken)
};

const catalogResponse = {
   mods: [
      {
         mod: { id: 1, name: 'BSIPA', summary: 'the loader', category: 'core', authors: [] },
         latest: {
            id: 10,
            modId: 1,
            modVersion: '4.3.5',
            zipHash: zipHashes.bsipa,
            contentHashes: [
               { path: 'IPA.exe', hash: md5('ipa-exe') },
               { path: 'IPA/Data/Managed/IPA.Injector.dll', hash: md5('injector') }
            ]
         }
      },
      {
         mod: { id: 2, name: 'BSML', summary: 'the ui library', category: 'library', authors: [] },
         latest: {
            id: 20,
            modId: 2,
            modVersion: '1.6.0',
            zipHash: zipHashes.bsml,
            dependencies: [10],
            contentHashes: [{ path: 'Plugins/BSML.dll', hash: md5('bsml') }]
         }
      },
      {
         mod: { id: 3, name: 'Counters+', summary: 'counters', category: 'gameplay', authors: [] },
         latest: {
            id: 30,
            modId: 3,
            modVersion: '2.1.0',
            zipHash: zipHashes.counters,
            dependencies: [20],
            contentHashes: [{ path: 'Plugins/Counters.dll', hash: md5('counters') }]
         }
      },
      {
         mod: { id: 4, name: 'Broken', summary: 'tampered', category: 'gameplay', authors: [] },
         latest: {
            id: 40,
            modId: 4,
            modVersion: '1.0.0',
            zipHash: zipHashes.broken,
            contentHashes: [{ path: 'Plugins/Broken.dll', hash: md5('broken') }]
         }
      }
   ]
};

function fakeBeatMods(url: string) {
   return Promise.resolve(Response.json(url.includes('/api/status') ? { status: 'ok' } : catalogResponse));
}

const archives = new Map(Object.values(modZips).map((zip) => [beatModsDownloadUrl(md5(zip)), zip]));
const fakeCdn: ContentFetch = (url) => {
   const archive = archives.get(url);

   return Promise.resolve(archive ? new Response(new Uint8Array(archive)) : new Response('not found', { status: 404 }));
};

function md5(value: string | Buffer) {
   return createHash('md5').update(value).digest('hex');
}
