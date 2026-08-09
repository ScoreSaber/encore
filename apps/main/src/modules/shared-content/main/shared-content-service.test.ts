import { Result } from 'better-result';

import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { SharedConnectRequest, SharedContentActionRequest } from '@/modules/shared-content/contract';
import { createSharedContentService } from '@/modules/shared-content/main/shared-content-service';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('shared content service', () => {
   test('shares content between installs and unlinks without draining the shared folder', async () => {
      const harness = await createHarness();
      const first = await harness.install('Beat Saber');
      const second = await harness.install('Beat Saber 1.29');
      await writePlaylist(first.path, 'one.bplist');

      await harness.run({ folderId: 'playlists', action: 'link' });
      await harness.run({ folderId: 'playlists', action: 'link', installId: second.id });
      const preview = await harness.shared.preview({
         installId: first.id,
         folderId: 'playlists',
         action: 'unlink',
         contents: 'move'
      });
      expect(preview).toMatchObject({ status: 'ok', contents: 'copy' });
      if (preview.status !== 'ok') return;
      expect(preview.warnings).toEqual(expect.arrayContaining(['move-blocked', 'shared-kept']));

      await harness.run({ folderId: 'playlists', action: 'unlink', contents: 'move' });

      expect(await readdir(join(harness.sharedRoot, 'Playlists'))).toEqual(['one.bplist']);
      expect(await readdir(join(first.path, 'Playlists'))).toEqual(['one.bplist']);
      expect(await readdir(join(second.path, 'Playlists'))).toEqual(['one.bplist']);
      expect((await harness.shared.rescan({ installId: first.id })).folders.find((folder) => folder.id === 'playlists')).toMatchObject({
         state: 'unlinked'
      });
   });

   test('keeps names that exist on both sides instead of overwriting them', async () => {
      const harness = await createHarness();
      const first = await harness.install('Beat Saber');
      const second = await harness.install('Beat Saber 1.29');
      await writePlaylist(first.path, 'same.bplist', 'first');
      await writePlaylist(second.path, 'same.bplist', 'second');

      await harness.run({ folderId: 'playlists', action: 'link' });
      expect(await harness.shared.preview({ installId: second.id, folderId: 'playlists', action: 'link' })).toMatchObject({
         status: 'ok',
         conflictCount: 1
      });
      await harness.run({ folderId: 'playlists', action: 'link', installId: second.id });

      expect(await readFile(join(harness.sharedRoot, 'Playlists', 'same.bplist'), 'utf8')).toContain('first');
      expect(await readFile(join(second.path, 'Playlists.encore-conflicts', 'same.bplist'), 'utf8')).toContain('second');
   });

   test('backs up a folder that holds settings before it is shared', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      await mkdir(join(install.path, 'UserData'), { recursive: true });
      await writeFile(join(install.path, 'UserData', 'settings.json'), '{"ok":true}', 'utf8');

      const preview = await harness.shared.preview({
         installId: install.id,
         folderId: 'user-data',
         action: 'link'
      });
      await harness.run({ folderId: 'user-data', action: 'link' });

      expect(preview).toMatchObject({ status: 'ok', warnings: expect.arrayContaining(['risky-folder']) });
      if (preview.status !== 'ok') return;
      expect(await readdir(preview.backupPath ?? '')).toEqual(['settings.json']);
      expect(await readdir(join(harness.sharedRoot, 'UserData'))).toEqual(['settings.json']);
   });

   test('manages a nested custom folder without also managing its parent', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      const customPath = join(install.path, 'UserData', 'BeatLeader');
      await mkdir(customPath, { recursive: true });
      await writeFile(join(customPath, 'settings.json'), '{"enabled":true}', 'utf8');

      const added = await harness.shared.addCustomFolder({ installId: install.id, relativePath: 'UserData/BeatLeader' });
      if (added.status !== 'ok') throw new Error('expected the custom folder to be added');

      const before = await harness.shared.rescan({ installId: install.id });
      expect(before.folders.some((folder) => folder.id === 'user-data')).toBe(false);

      await harness.run({ folderId: added.folder.id, action: 'link' });
      expect(await readFile(join(harness.sharedRoot, 'UserData', 'BeatLeader', 'settings.json'), 'utf8')).toBe('{"enabled":true}');
      expect(await harness.shared.forgetCustomFolder({ folderId: added.folder.id })).toMatchObject({
         status: 'invalid',
         issue: 'folder-linked'
      });

      await harness.run({ folderId: added.folder.id, action: 'unlink', contents: 'keep' });
      await harness.shared.forgetCustomFolder({ folderId: added.folder.id });
      expect((await harness.shared.rescan({ installId: install.id })).folders.some((folder) => folder.id === 'user-data')).toBe(true);
   });

   test('rejects custom folders outside the install and overlapping custom entries', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      await mkdir(join(install.path, 'UserData', 'BeatLeader', 'Cache'), { recursive: true });

      expect(await harness.shared.addCustomFolder({ installId: install.id, relativePath: '../elsewhere' })).toMatchObject({
         status: 'invalid',
         issue: 'outside-install'
      });
      expect(await harness.shared.addCustomFolder({ installId: install.id, relativePath: 'Beat Saber_Data' })).toMatchObject({
         status: 'invalid',
         issue: 'unsafe-folder'
      });

      expect(await harness.shared.addCustomFolder({ installId: install.id, relativePath: 'UserData/BeatLeader' })).toMatchObject({ status: 'ok' });
      expect(await harness.shared.addCustomFolder({ installId: install.id, relativePath: 'UserData/BeatLeader/Cache' })).toMatchObject({
         status: 'invalid',
         issue: 'overlapping-folder'
      });
   });

   test('repairs a link that points somewhere else without touching what it pointed at', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      const elsewhere = join(harness.dataPath, 'elsewhere');
      await mkdir(elsewhere, { recursive: true });
      await writeFile(join(elsewhere, 'keep.bplist'), '{}', 'utf8');
      await symlink(elsewhere, join(install.path, 'Playlists'), 'dir');

      expect((await harness.shared.rescan({ installId: install.id })).folders.find((folder) => folder.id === 'playlists')).toMatchObject({
         state: 'foreign'
      });
      await harness.run({ folderId: 'playlists', action: 'repair' });

      expect((await harness.shared.rescan({ installId: install.id })).folders.find((folder) => folder.id === 'playlists')).toMatchObject({
         state: 'linked'
      });
      expect(await readdir(elsewhere)).toEqual(['keep.bplist']);
   });

   test('connects an install to the active root and disconnects with its own copies', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      await writePlaylist(install.path, 'one.bplist');

      const preview = await harness.shared.previewConnect({ installId: install.id, action: 'connect' });
      expect(preview).toMatchObject({ status: 'ok', action: 'connect', contents: 'move' });
      if (preview.status !== 'ok') return;
      expect(preview.warnings).toEqual(expect.arrayContaining(['creates-shared-folder']));
      expect(preview.folders.find((folder) => folder.id === 'playlists')).toMatchObject({ step: 'link' });
      expect(preview.folders.find((folder) => folder.id === 'user-data')).toMatchObject({ step: 'skip', risky: true });

      await harness.runConnect({ action: 'connect' });
      expect((await harness.shared.rescan({ installId: install.id })).folders.find((folder) => folder.id === 'playlists')).toMatchObject({
         state: 'linked',
         rootPath: harness.sharedRoot
      });
      expect(await readdir(join(harness.sharedRoot, 'Playlists'))).toEqual(['one.bplist']);

      await harness.runConnect({ action: 'disconnect' });
      expect((await harness.shared.rescan({ installId: install.id })).folders.find((folder) => folder.id === 'playlists')).toMatchObject({
         state: 'unlinked'
      });
      expect(await readdir(join(harness.sharedRoot, 'Playlists'))).toEqual(['one.bplist']);
      expect(await readdir(join(install.path, 'Playlists'))).toEqual(['one.bplist']);
   });

   test('keeps the connect preview alive when only risky folders are left', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      await writePlaylist(install.path, 'one.bplist');
      await harness.runConnect({ action: 'connect' });

      // every default folder is linked, so only the opt-in risky one could still change
      const held = await harness.shared.previewConnect({ installId: install.id, action: 'connect' });
      expect(held).toMatchObject({ status: 'ok' });
      if (held.status !== 'ok') return;
      expect(held.folders.every((folder) => folder.step === 'skip')).toBe(true);

      const risky = await harness.shared.previewConnect({ installId: install.id, action: 'connect', includeRisky: true });
      expect(risky).toMatchObject({ status: 'ok' });
      if (risky.status !== 'ok') return;
      expect(risky.folders.find((folder) => folder.id === 'user-data')).toMatchObject({ step: 'link' });

      // disconnect ignores the risky opt-in, so a fully unlinked install still has nothing to do
      await harness.runConnect({ action: 'disconnect' });
      expect(await harness.shared.previewConnect({ installId: install.id, action: 'disconnect' })).toMatchObject({
         status: 'invalid',
         issue: 'nothing-to-connect'
      });
   });

   test('manages roots: add, activate, forget and refuse to drop the active one', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      const rootB = join(harness.dataPath, 'other-root');
      await mkdir(join(rootB, 'Playlists'), { recursive: true });

      expect(await harness.shared.addRoot({ path: install.path })).toMatchObject({ status: 'invalid', issue: 'root-inside-install' });
      expect(await harness.shared.addRoot({ path: join(install.path, 'Playlists'), activate: true })).toMatchObject({
         status: 'invalid',
         issue: 'root-inside-install'
      });

      const candidate = await harness.shared.chooseRootCandidate({ path: rootB });
      expect(candidate).toMatchObject({
         exists: true,
         alreadyKnown: false,
         foldersFound: [{ id: 'playlists', relativePath: 'Playlists' }]
      });

      expect(await harness.shared.addRoot({ path: rootB, activate: true })).toMatchObject({ status: 'ok' });
      const overview = await harness.shared.getOverview();
      expect(overview.sharedRootPath).toBe(candidate.path);
      expect(overview.roots.map((root) => root.active)).toEqual([true, false]);

      expect(await harness.shared.forgetRoot({ path: rootB })).toMatchObject({ status: 'invalid', issue: 'root-active' });
      expect(await harness.shared.activateRoot({ path: join(harness.dataPath, 'nowhere') })).toMatchObject({
         status: 'invalid',
         issue: 'root-unknown'
      });

      expect(await harness.shared.forgetRoot({ path: harness.sharedRoot })).toMatchObject({ status: 'ok' });
      expect((await harness.shared.getOverview()).roots.map((root) => root.path)).toEqual([candidate.path]);
   });

   test('switches an install to another root without moving the shared files', async () => {
      const harness = await createHarness();
      const install = await harness.install('Beat Saber');
      await writePlaylist(install.path, 'one.bplist');
      await harness.run({ folderId: 'playlists', action: 'link' });

      const rootB = join(harness.dataPath, 'other-root');
      expect(await harness.shared.addRoot({ path: rootB, activate: true })).toMatchObject({ status: 'ok' });

      // the old link points into a known root, so it reads as linked instead of foreign
      expect((await harness.shared.rescan({ installId: install.id })).folders.find((folder) => folder.id === 'playlists')).toMatchObject({
         state: 'linked',
         rootPath: harness.sharedRoot
      });

      const preview = await harness.shared.previewConnect({ installId: install.id, action: 'connect' });
      expect(preview).toMatchObject({ status: 'ok' });
      if (preview.status !== 'ok') return;
      expect(preview.folders.find((folder) => folder.id === 'playlists')).toMatchObject({ step: 'repair' });

      await harness.runConnect({ action: 'connect' });
      const switched = (await harness.shared.rescan({ installId: install.id })).folders.find((folder) => folder.id === 'playlists');
      expect(switched).toMatchObject({ state: 'linked', rootPath: preview.rootPath });
      expect(await readdir(join(harness.sharedRoot, 'Playlists'))).toEqual(['one.bplist']);
   });
});

async function writePlaylist(installPath: string, fileName: string, title = 'shared') {
   await mkdir(join(installPath, 'Playlists'), { recursive: true });
   await writeFile(join(installPath, 'Playlists', fileName), JSON.stringify({ playlistTitle: title }), 'utf8');
}

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-shared-content-'));
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
   const shared = createSharedContentService({ registry, settingsStore, operations, platform: 'linux' });

   cleanups.push(async () => {
      shared.dispose();
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   let firstInstallId = '';

   return {
      dataPath,
      sharedRoot: join(installRoot, 'shared'),
      shared,
      install: async (name: string) => {
         const installPath = join(installRoot, name);
         await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
         await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
         await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');
         const registered = await registry.register({ source: 'library', path: installPath });
         if (Result.isError(registered)) throw new Error('registration failed');
         firstInstallId ||= registered.value.id;

         return registered.value;
      },
      run: async (request: Partial<SharedContentActionRequest> & Pick<SharedContentActionRequest, 'action' | 'folderId'>) => {
         const started = await shared.start({ installId: firstInstallId, ...request });
         expect(started.ok).toBe(true);
         if (!started.ok) throw new Error(started.error.message);

         const finished = await waitForOperation(operations, started.value.id);
         expect(finished.status).toBe('completed');

         return finished;
      },
      runConnect: async (request: Partial<SharedConnectRequest> & Pick<SharedConnectRequest, 'action'>) => {
         const started = await shared.startConnect({ installId: firstInstallId, ...request });
         expect(started.ok).toBe(true);
         if (!started.ok) throw new Error(started.error.message);

         const finished = await waitForOperation(operations, started.value.id);
         expect(finished.status).toBe('completed');

         return finished;
      }
   };
}
