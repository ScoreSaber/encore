import { Result } from 'better-result';

import type { InstallDetail } from '@/modules/installs/contract';
import { createInstallManagementService } from '@/modules/installs/main/install-management';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot, StoreInstallCandidate } from '@/modules/stores/contract';

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

describe('install management', () => {
   test('deletes an install in place and refuses the folders a store owns', async () => {
      const harness = await createHarness();
      const detected = await createInstallFolder(harness.dataPath, 'Steam Beat Saber', '1.37.0');
      const importedPath = await createInstallFolder(harness.dataPath, 'Beat Saber', '1.37.0');
      harness.setCandidates([createCandidate(detected)]);
      const imported = await harness.register(importedPath);
      const store = (await harness.registry.list()).installs.find((install) => install.source === 'store')!;

      expect(await harness.management.previewDelete({ installId: store.id })).toMatchObject({ status: 'invalid', issue: 'store-owned' });
      expect(await harness.management.delete({ installId: store.id })).toMatchObject({
         ok: false,
         error: { code: 'installs.manage.store-owned' }
      });
      expect(await harness.management.previewDelete({ installId: imported.id })).toMatchObject({
         status: 'ok',
         path: importedPath,
         source: 'imported'
      });

      const started = await harness.management.delete({ installId: imported.id });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ kind: 'delete', status: 'completed' });
      expect(await readdir(harness.dataPath)).not.toContain('Beat Saber');
      expect((await harness.registry.list()).installs.map((install) => install.id)).toEqual([store.id]);
      expect(await readdir(detected)).toContain('Beat Saber.exe');
   });

   test('forgets an install without deleting it and keeps detected installs listed', async () => {
      const harness = await createHarness();
      const detected = await createInstallFolder(harness.dataPath, 'Steam Beat Saber', '1.37.0');
      const importedPath = await createInstallFolder(harness.dataPath, 'Beat Saber', '1.37.0');
      harness.setCandidates([createCandidate(detected)]);
      const imported = await harness.register(importedPath);
      const store = (await harness.registry.list()).installs.find((install) => install.source === 'store')!;

      expect(await harness.management.previewForget({ installId: store.id })).toMatchObject({ status: 'invalid', issue: 'store-detected' });
      expect(await harness.management.forget({ installId: store.id })).toMatchObject({
         ok: false,
         error: { code: 'installs.manage.store-detected' }
      });
      expect(await harness.management.previewForget({ installId: imported.id })).toMatchObject({
         status: 'ok',
         path: importedPath,
         source: 'imported'
      });
      expect(await harness.management.forget({ installId: imported.id })).toMatchObject({
         ok: true,
         value: { installId: imported.id, path: importedPath }
      });

      expect((await harness.registry.list()).installs.map((install) => install.id)).toEqual([store.id]);
      expect(await readdir(importedPath)).toContain('Beat Saber.exe');
   });

   test('forgets an install when its folder was already deleted', async () => {
      const harness = await createHarness();
      const importedPath = await createInstallFolder(harness.dataPath, 'Beat Saber', '1.37.0');
      const imported = await harness.register(importedPath);
      await rm(importedPath, { recursive: true });

      expect(await harness.management.previewDelete({ installId: imported.id })).toMatchObject({
         status: 'ok',
         path: importedPath,
         sizeBytes: 0,
         fileCount: 0
      });

      const started = await harness.management.delete({ installId: imported.id });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ kind: 'delete', status: 'completed' });
      expect((await harness.registry.list()).installs).toEqual([]);
   });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-manage-'));
   const installRoot = join(dataPath, 'library');
   await mkdir(installRoot, { recursive: true });

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   await settingsStore.updateLibrarySettings({ installRoot });

   let candidates: StoreInstallCandidate[] = [];
   const detectStores = (): Promise<StoreDetectionSnapshot> =>
      Promise.resolve({
         targetId: 'local',
         platform: 'linux',
         scannedAt: new Date().toISOString(),
         stores: [],
         candidates,
         diagnostics: []
      });

   const registry = createInstallRegistry({ dataPath, settingsStore, detectStores });
   const operations = createOperationRegistry();
   const management = createInstallManagementService({ registry, operations });

   cleanups.push(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      installRoot,
      settingsStore,
      registry,
      operations,
      management,
      register: async (path: string): Promise<InstallDetail> => {
         const registered = await registry.register({ source: 'imported', path });
         if (Result.isError(registered)) throw new Error('registration failed');

         return registered.value;
      },
      setCandidates: (next: StoreInstallCandidate[]) => {
         candidates = next;
      }
   };
}

async function createInstallFolder(parentPath: string, name: string, version: string) {
   const installPath = join(parentPath, name);
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), `public.app-category.games  ${version} `, 'latin1');

   return installPath;
}

function createCandidate(installPath: string): StoreInstallCandidate {
   return {
      id: `steam:${installPath}`,
      targetId: 'local',
      store: 'steam',
      path: installPath,
      libraryPath: installPath,
      appId: '620980'
   };
}
