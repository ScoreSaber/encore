import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot, StoreInstallCandidate } from '@/modules/stores/contract';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('install registry', () => {
   test('keeps a store install id when the library moves and drops it when detection does', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-installs-'));
      const installRoot = join(dataPath, 'library');
      await mkdir(installRoot, { recursive: true });
      const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
      await settingsStore.updateLibrarySettings({ installRoot });

      let candidates: StoreInstallCandidate[] = [];
      const registry = createInstallRegistry({
         dataPath,
         settingsStore,
         detectStores: (): Promise<StoreDetectionSnapshot> =>
            Promise.resolve({
               targetId: 'local',
               platform: 'linux',
               scannedAt: new Date().toISOString(),
               stores: [],
               candidates,
               diagnostics: []
            })
      });
      cleanups.push(async () => {
         registry.dispose();
         await rm(dataPath, { recursive: true, force: true });
      });

      const firstLibrary = join(dataPath, 'SteamLibrary');
      await createInstall(firstLibrary);
      candidates = [createCandidate(firstLibrary)];
      const detected = (await registry.list()).installs[0];
      if (!detected) throw new Error('store install was not detected');

      const secondLibrary = join(dataPath, 'SteamLibrary2');
      await createInstall(secondLibrary);
      candidates = [createCandidate(secondLibrary)];
      const moved = (await registry.rescan()).installs[0];
      if (!moved) throw new Error('moved store install was not detected');

      expect(moved).toMatchObject({
         id: detected.id,
         path: join(secondLibrary, 'steamapps', 'common', 'Beat Saber'),
         store: 'steam',
         version: '1.34.2',
         status: 'ready'
      });
      expect((await registry.get(moved.id))?.aliases).toHaveLength(1);

      candidates = [];
      expect((await registry.rescan()).installs).toEqual([]);
   });
});

async function createInstall(libraryPath: string) {
   const installPath = join(libraryPath, 'steamapps', 'common', 'Beat Saber');
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.34.2 ', 'latin1');
}

function createCandidate(libraryPath: string): StoreInstallCandidate {
   return {
      id: `steam:${libraryPath}`,
      targetId: 'local',
      store: 'steam',
      path: join(libraryPath, 'steamapps', 'common', 'Beat Saber'),
      libraryPath,
      appId: '620980'
   };
}
