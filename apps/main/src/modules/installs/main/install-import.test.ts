import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createInstallImportService } from '@/modules/installs/main/install-import';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

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

describe('install import', () => {
   test('registers a folder in place and leaves its contents alone', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-import-'));
      const installRoot = join(dataPath, 'library');
      const source = join(dataPath, 'Beat Saber');
      await mkdir(installRoot, { recursive: true });
      await mkdir(join(source, 'Beat Saber_Data'), { recursive: true });
      await writeFile(join(source, 'Beat Saber.exe'), 'stub', 'utf8');
      await writeFile(join(source, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');

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
      const imports = createInstallImportService({ settingsStore, registry });
      cleanups.push(async () => {
         registry.dispose();
         await rm(dataPath, { recursive: true, force: true });
      });

      expect(await imports.preview(source)).toMatchObject({ status: 'ok', version: '1.37.0', sourcePath: source, source: 'imported' });
      expect(await imports.start(source)).toMatchObject({
         ok: true,
         value: { name: '1.37.0', path: source, source: 'imported', status: 'ready' }
      });
      expect((await registry.list()).installs).toMatchObject([{ path: source, version: '1.37.0' }]);
      expect((await readdir(source)).sort()).toEqual(['Beat Saber.exe', 'Beat Saber_Data']);
      expect(await readdir(installRoot)).toEqual([]);
   });
});
