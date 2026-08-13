import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import type { ModelType } from '@/modules/models/contract';
import { modelFolderPath } from '@/modules/models/main/model-paths';
import type { ModelSaberCatalog } from '@/modules/models/main/model-saber-catalog';
import { createModelService } from '@/modules/models/main/model-service';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
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

describe('model service', () => {
   test('deletes only the selected model file', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      const keep = await writeModelFile(harness.dataPath, 'Keep.saber');
      const drop = await writeModelFile(harness.dataPath, 'Drop.saber', 'other bytes');

      const imported = await harness.models.startImport({ installId: install.id, paths: [keep, drop] });
      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      await waitForOperation(harness.operations, imported.value.id);

      const started = await harness.models.startDelete({ installId: install.id, modelIds: ['saber:Drop.saber'] });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      expect(finished?.status).toBe('completed');
      expect(await readdir(modelFolderPath(install.path, 'saber'))).toEqual(['Keep.saber']);
   });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-model-service-'));
   const installRoot = join(dataPath, 'library');
   await mkdir(installRoot, { recursive: true });

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   await settingsStore.updateLibrarySettings({ installRoot });
   const installPath = await createInstallFolder(installRoot, 'Beat Saber');

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
   await registry.register({ source: 'library', path: installPath });
   const operations = createOperationRegistry();
   const catalog: ModelSaberCatalog = {
      search: (input) => Promise.resolve(Result.ok([catalogRecord('a1b2c3', input.type)])),
      getById: () => Promise.resolve(Result.ok(catalogRecord('a1b2c3', 'saber'))),
      getByHash: () => Promise.resolve(Result.ok(catalogRecord('a1b2c3', 'saber'))),
      pageSize: 20
   };
   const models = createModelService({ registry, operations, dataPath, catalog });

   cleanups.push(async () => {
      models.dispose();
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      operations,
      models,
      firstInstall: async () => {
         const install = (await registry.list()).installs[0];
         if (!install) throw new Error('test install was not registered');
         return install;
      }
   };
}

function catalogRecord(hash: string, type: ModelType) {
   return {
      summary: {
         id: '42',
         type,
         name: 'Rainbow',
         author: 'Author',
         hash,
         thumbnailUrl: null,
         tags: [],
         publishedAt: null,
         installed: false
      },
      downloadUrl: 'https://cdn.modelsaber.com/sabers/rainbow.saber'
   };
}

async function createInstallFolder(parentPath: string, name: string) {
   const installPath = join(parentPath, name);
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');

   return installPath;
}

async function writeModelFile(parentPath: string, fileName: string, contents = 'model bytes') {
   const path = join(parentPath, fileName);
   await writeFile(path, contents, 'utf8');

   return path;
}
