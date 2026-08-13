import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import { createBSManagerAdoptionService } from '@/modules/bsmanager/main/adoption-service';
import { readBSManagerAppConfig } from '@/modules/bsmanager/main/bsmanager-config';
import { createBSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('bsmanager adoption', () => {
   test('adopts selected versions in place with their shared content', async () => {
      const harness = await createHarness();
      const installPath = await harness.writeVersion('1.37.0');
      await harness.writeVersion('1.29.1');
      await harness.writeConfig([
         { BSVersion: '1.37.0', color: '#22c55e', metadata: { id: 'one', store: 'STEAM' } },
         { BSVersion: '1.29.1', metadata: { id: 'two', store: 'OCULUS' } }
      ]);
      const sharedMaps = join(harness.rootPath, 'SharedContent', 'SharedMaps', 'CustomLevels');
      await mkdir(sharedMaps, { recursive: true });
      await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
      await symlink(sharedMaps, join(installPath, 'Beat Saber_Data', 'CustomLevels'), process.platform === 'win32' ? 'junction' : 'dir');

      const plan = await harness.adoption.plan();
      if (plan.status !== 'ok') throw new Error(`expected a plan, got ${plan.issue}`);

      expect(plan.rootPath).toBe(harness.rootPath);
      expect(plan.versions).toMatchObject([
         { id: '1.29.1', store: 'oculus', status: 'ready' },
         { id: '1.37.0', store: 'steam', color: '#22c55e', status: 'ready' }
      ]);
      expect(plan.versions[1]?.folders.find((folder) => folder.id === 'maps')).toMatchObject({
         state: 'linked',
         linkTargetPath: sharedMaps
      });

      const adopted = await harness.adoption.adopt({
         rootPath: harness.rootPath,
         versionIds: ['1.37.0'],
         adoptSharedRoot: true
      });
      expect(adopted).toMatchObject({
         ok: true,
         value: { adopted: 1, skipped: 1, sharedRootPath: join(harness.rootPath, 'SharedContent') }
      });
      expect((await harness.registry.list()).installs).toMatchObject([
         { path: installPath, source: 'bsmanager', name: '1.37.0', store: 'steam', color: '#22c55e' }
      ]);
      expect((await harness.settingsStore.getSnapshot()).library).toMatchObject({
         sharedRoot: join(harness.rootPath, 'SharedContent'),
         // the default previous root never existed on disk, so it is not kept around
         sharedRoots: [],
         useSymlinks: true
      });
   });

   test('keeps a previous root that exists on disk when adopting the BSManager one', async () => {
      const harness = await createHarness();
      await harness.writeVersion('1.37.0');
      await harness.writeConfig([{ BSVersion: '1.37.0', metadata: { id: 'one', store: 'STEAM' } }]);
      const previousRoot = join(harness.rootPath, 'OldShared');
      await mkdir(previousRoot, { recursive: true });
      await harness.settingsStore.updateLibrarySettings({ sharedRoot: previousRoot });

      const adopted = await harness.adoption.adopt({
         rootPath: harness.rootPath,
         versionIds: ['1.37.0'],
         adoptSharedRoot: true
      });

      expect(adopted).toMatchObject({ ok: true });
      expect((await harness.settingsStore.getSnapshot()).library).toMatchObject({
         sharedRoot: join(harness.rootPath, 'SharedContent'),
         sharedRoots: [previousRoot]
      });
   });

   test('repairs the store on an already adopted version from lowercase BSManager metadata', async () => {
      const harness = await createHarness();
      const installPath = await harness.writeVersion('1.37.0');
      const registered = await harness.registry.register({ source: 'bsmanager', path: installPath });
      if (Result.isError(registered)) throw new Error('expected the version to register');

      await harness.writeConfig([{ BSVersion: '1.37.0', metadata: { id: 'one', store: 'oculus' } }]);
      await harness.adoption.migrateAdoptedSetup();
      const plan = await harness.adoption.plan();

      expect(plan).toMatchObject({ status: 'ok', versions: [{ id: '1.37.0', store: 'oculus', status: 'adopted' }] });
      expect((await harness.registry.get(registered.value.id))?.store).toBe('oculus');
   });

   test('detects a version store from its BSManager metadata file', async () => {
      const harness = await createHarness();
      const installPath = await harness.writeVersion('1.37.0');
      await writeFile(join(installPath, 'metadata.config'), JSON.stringify({ id: 'one', store: 'oculus' }), 'utf8');

      const plan = await harness.adoption.plan();

      expect(plan).toMatchObject({ status: 'ok', versions: [{ id: '1.37.0', store: 'oculus', status: 'ready' }] });
   });

   test('migrates custom links for versions adopted by an earlier Encore release', async () => {
      const harness = await createHarness();
      const installPath = await harness.writeVersion('1.37.0');
      const registered = await harness.registry.register({ source: 'bsmanager', path: installPath, store: 'steam' });
      if (Result.isError(registered)) throw new Error('expected the version to register');

      const sharedFolder = join(harness.rootPath, 'SharedContent', 'BeatLeader');
      await mkdir(sharedFolder, { recursive: true });
      await mkdir(join(installPath, 'UserData'), { recursive: true });
      await symlink(sharedFolder, join(installPath, 'UserData', 'BeatLeader'), process.platform === 'win32' ? 'junction' : 'dir');

      await harness.adoption.migrateAdoptedSetup();

      const customFolders = (await harness.settingsStore.getSnapshot()).library.customFolders;
      expect(customFolders).toHaveLength(1);
      expect(customFolders[0]?.installRelativePath).toBe('UserData/BeatLeader');
      expect(customFolders[0]?.libraryRelativePath).toBe('BeatLeader');
   });

   test('only converts links between installs after explicit cleanup', async () => {
      const harness = await createHarness();
      const firstInstall = await harness.writeVersion('1.37.0');
      const secondInstall = await harness.writeVersion('1.29.1');
      await harness.writeConfig([
         { BSVersion: '1.37.0', metadata: { id: 'one', store: 'STEAM' } },
         { BSVersion: '1.29.1', metadata: { id: 'two', store: 'STEAM' } }
      ]);
      await harness.writeAppConfig(false);

      const sourceMaps = join(secondInstall, 'Beat Saber_Data', 'CustomLevels');
      const firstMaps = join(firstInstall, 'Beat Saber_Data', 'CustomLevels');
      await mkdir(sourceMaps, { recursive: true });
      await writeFile(join(sourceMaps, 'song.dat'), 'map', 'utf8');
      await symlink(sourceMaps, firstMaps, process.platform === 'win32' ? 'junction' : 'dir');

      const plan = await harness.adoption.plan();
      if (plan.status !== 'ok') throw new Error(`expected a plan, got ${plan.issue}`);
      expect(plan.versions.find((version) => version.id === '1.37.0')?.folders.find((folder) => folder.id === 'maps')).toMatchObject({
         state: 'foreign',
         linkTargetPath: sourceMaps
      });

      const adopted = await harness.adoption.adopt({
         rootPath: harness.rootPath,
         versionIds: ['1.37.0', '1.29.1'],
         adoptSharedRoot: true
      });
      expect(adopted).toMatchObject({ ok: true, value: { adopted: 2 } });
      expect(linkTarget(await readlink(firstMaps))).toBe(sourceMaps);

      const cleaned = await harness.adoption.cleanup({ rootPath: harness.rootPath });
      if (!cleaned.ok) throw new Error('expected cleanup to start');

      const finished = await waitForOperation(harness.operations, cleaned.value.id);
      expect(finished).toMatchObject({ status: 'completed', result: { folders: 2, backups: 1 } });

      const sharedMaps = join(harness.rootPath, 'SharedContent', 'SharedMaps', 'CustomLevels');
      expect(await readFile(join(sharedMaps, 'song.dat'), 'utf8')).toBe('map');
      expect(await readFile(join(`${sourceMaps}.encore-backup`, 'song.dat'), 'utf8')).toBe('map');
      expect(linkTarget(await readlink(firstMaps))).toBe(sharedMaps);
      expect(linkTarget(await readlink(sourceMaps))).toBe(sharedMaps);

      const appConfig = await readBSManagerAppConfig(join(harness.appDataPath, 'bs-manager', 'config.json'));
      expect(appConfig['use-symlinks']).toBe(process.platform !== 'win32');
   });

   test('adopts and converts a custom nested folder link', async () => {
      const harness = await createHarness();
      const firstInstall = await harness.writeVersion('1.37.0');
      const secondInstall = await harness.writeVersion('1.29.1');
      await harness.writeConfig([
         { BSVersion: '1.37.0', metadata: { id: 'one', store: 'STEAM' } },
         { BSVersion: '1.29.1', metadata: { id: 'two', store: 'STEAM' } }
      ]);

      const sourceFolder = join(secondInstall, 'UserData', 'BeatLeader');
      const linkedFolder = join(firstInstall, 'UserData', 'BeatLeader');
      await mkdir(sourceFolder, { recursive: true });
      await mkdir(join(firstInstall, 'UserData'), { recursive: true });
      await writeFile(join(sourceFolder, 'settings.json'), '{"enabled":true}', 'utf8');
      await symlink(sourceFolder, linkedFolder, process.platform === 'win32' ? 'junction' : 'dir');

      const plan = await harness.adoption.plan();
      if (plan.status !== 'ok') throw new Error(`expected a plan, got ${plan.issue}`);
      const custom = plan.customFolders.find((folder) => folder.installRelativePath === 'UserData/BeatLeader');
      if (!custom) throw new Error('expected the custom folder to be detected');

      const adopted = await harness.adoption.adopt({
         rootPath: harness.rootPath,
         versionIds: ['1.37.0', '1.29.1'],
         adoptSharedRoot: true
      });
      if (!adopted.ok) throw new Error('expected adoption to complete');
      expect((await harness.settingsStore.getSnapshot()).library.customFolders).toContainEqual(custom);

      const cleaned = await harness.adoption.cleanup({ rootPath: harness.rootPath });
      if (!cleaned.ok) throw new Error('expected cleanup to start');
      expect(await waitForOperation(harness.operations, cleaned.value.id)).toMatchObject({ status: 'completed' });

      const sharedFolder = join(harness.rootPath, 'SharedContent', 'BeatLeader');
      expect(await readFile(join(sharedFolder, 'settings.json'), 'utf8')).toBe('{"enabled":true}');
      expect(linkTarget(await readlink(linkedFolder))).toBe(sharedFolder);
      expect(linkTarget(await readlink(sourceFolder))).toBe(sharedFolder);
   });
});

type ConfigVersion = {
   BSVersion: string;
   color?: string;
   metadata?: { id: string; store: 'steam' | 'oculus' | 'STEAM' | 'OCULUS' };
};

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-bsmanager-'));
   const installRoot = join(dataPath, 'library');
   const appDataPath = join(dataPath, 'appdata');
   const rootPath = join(dataPath, 'games', 'BSManager');
   const versionsPath = join(rootPath, 'BSInstances');

   await mkdir(installRoot, { recursive: true });
   await mkdir(join(appDataPath, 'bs-manager'), { recursive: true });
   await mkdir(versionsPath, { recursive: true });
   await writeFile(
      join(appDataPath, 'bs-manager', 'config.json'),
      JSON.stringify({ 'installation-folder': join(dataPath, 'games'), 'use-symlinks': true }),
      'utf8'
   );

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: process.platform, arch: 'x64' });
   await settingsStore.updateLibrarySettings({ installRoot });
   const detectStores = (): Promise<StoreDetectionSnapshot> =>
      Promise.resolve({
         targetId: 'local',
         platform: process.platform,
         scannedAt: new Date().toISOString(),
         stores: [],
         candidates: [],
         diagnostics: []
      });
   const registry = createInstallRegistry({ dataPath, settingsStore, detectStores });
   const operations = createOperationRegistry();
   const locations = { platform: process.platform, homePath: dataPath, documentsPath: join(dataPath, 'documents'), appDataPath };
   const adoption = createBSManagerAdoptionService({
      registry,
      settingsStore,
      converter: createBSManagerSharedContentConverter({ operations, locations }),
      locations
   });

   cleanups.push(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      rootPath,
      appDataPath,
      registry,
      settingsStore,
      operations,
      adoption,
      writeAppConfig: (useSymlinks: boolean) =>
         writeFile(
            join(appDataPath, 'bs-manager', 'config.json'),
            JSON.stringify({ 'installation-folder': join(dataPath, 'games'), 'use-symlinks': useSymlinks }),
            'utf8'
         ),
      writeVersion: async (folderName: string) => {
         const installPath = join(versionsPath, folderName);
         await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
         await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
         await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), `public.app-category.games  ${folderName} `, 'latin1');

         return installPath;
      },
      writeConfig: (versions: ConfigVersion[]) => writeFile(join(rootPath, 'config.cfg'), JSON.stringify({ 'custom-versions': versions }), 'utf8')
   };
}

function linkTarget(path: string) {
   return path.replace(/^\\\\\?\\/, '');
}
