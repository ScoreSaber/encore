import { expect, onTestFinished, test, vi } from 'vite-plus/test';

import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import type { SharedContentActionRequest } from '@/modules/shared-content/contract';
import { createSharedContentService } from '@/modules/shared-content/main/shared-content-service';
import { customSharedFolderId } from '@/modules/shared-content/main/shared-library';

import { chmod, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('linking keeps conflicting files and unlinking never drains the shared folder', async () => {
   const { installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const sharedPlaylists = join(installRoot, 'shared', 'Playlists');
   const first = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const second = await register(await writeInstallFolder(join(installRoot, 'Beat Saber 1.29')));
   await writePlaylist(first.path, 'one.bplist', 'one');
   await writePlaylist(first.path, 'same.bplist', 'first');
   await writePlaylist(second.path, 'same.bplist', 'second');
   const run = async (request: SharedContentActionRequest) => {
      const started = await shared.start(request);
      if (!started.ok) throw new Error(started.error.message);

      expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed' });
   };

   await run({ installId: first.id, folderId: 'playlists', action: 'link' });
   await run({ installId: second.id, folderId: 'playlists', action: 'link' });

   expect(await readFile(join(sharedPlaylists, 'same.bplist'), 'utf8')).toContain('first');
   expect(await readFile(join(second.path, 'Playlists.encore-conflicts', 'same.bplist'), 'utf8')).toContain('second');

   await run({ installId: first.id, folderId: 'playlists', action: 'unlink', contents: 'move' });

   expect(await readdir(sharedPlaylists)).toEqual(['one.bplist', 'same.bplist']);
   expect(await readdir(join(first.path, 'Playlists'))).toEqual(['one.bplist', 'same.bplist']);
   expect(await readdir(join(second.path, 'Playlists'))).toEqual(['one.bplist', 'same.bplist']);
});

test('links a nested custom folder when its install-side parents are missing', async () => {
   const { installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const installRelativePath = 'UserData/ScoreSaber/Replays';
   const libraryRelativePath = 'Replays';
   const folderId = customSharedFolderId(installRelativePath, libraryRelativePath);
   await settingsStore.updateLibrarySettings({ customFolders: [{ id: folderId, installRelativePath, libraryRelativePath }] });

   const started = await shared.start({ installId: install.id, folderId, action: 'link' });
   if (!started.ok) throw new Error(started.error.message);

   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed' });
   const snapshot = await shared.list({ installId: install.id });
   expect(snapshot.folders).toContainEqual(expect.objectContaining({ id: folderId, state: 'linked' }));
   const target = await readlink(join(install.path, installRelativePath));
   await writeFile(join(install.path, installRelativePath, 'replay.dat'), 'replay');
   expect(await readFile(join(target, 'replay.dat'), 'utf8')).toBe('replay');
});

test.each([
   ['blocked', 'path-blocked'],
   ['foreign', 'already-linked'],
   ['removed-definition', 'unknown-folder']
] as const)('bulk connect fails when a planned folder becomes %s', async (change, issue) => {
   const { installRoot, settingsStore, operations, shared, install } = await createBulkTestbed();
   const start = operations.start;
   const spy = vi.spyOn(operations, 'start').mockImplementation((input, run, job) =>
      start(
         input,
         async (id, signal) => {
            // Change disk/settings after the bulk plan is built, before its job starts.
            if (change === 'removed-definition') {
               await settingsStore.updateLibrarySettings({ customFolders: [] });
            } else {
               await mkdir(join(install.path, 'Custom'), { recursive: true });
               if (change === 'blocked') await writeFile(join(install.path, 'Custom/Replays'), 'blocked');
               else {
                  const foreign = join(installRoot, 'foreign');
                  await mkdir(foreign);
                  await symlink(foreign, join(install.path, 'Custom/Replays'));
               }
            }
            return run(id, signal);
         },
         job
      )
   );
   onTestFinished(() => spy.mockRestore());

   const started = await shared.startConnect({ installId: install.id, action: 'connect', includeRisky: true });
   if (!started.ok) throw new Error(started.error.message);
   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'failed', error: { code: `shared-content.${issue}` } });
});

test('bulk connect succeeds when another process has already linked its planned folders', async () => {
   const { operations, shared, install } = await createBulkTestbed();
   const preview = await shared.previewConnect({ installId: install.id, action: 'connect', includeRisky: true });
   if (preview.status !== 'ok') throw new Error(preview.issue);
   const snapshot = await shared.list({ installId: install.id });
   const start = operations.start;
   const spy = vi.spyOn(operations, 'start').mockImplementation((input, run, job) =>
      start(
         input,
         async (id, signal) => {
            for (const folder of preview.folders) {
               if (folder.step === 'skip') continue;
               const status = snapshot.folders.find((entry) => entry.id === folder.id);
               if (!status) throw new Error(`Missing folder ${folder.id}`);
               const path = join(install.path, folder.relativePath);
               await mkdir(status.sharedFolderPath, { recursive: true });
               await mkdir(join(path, '..'), { recursive: true });
               await symlink(status.sharedFolderPath, path);
            }
            return run(id, signal);
         },
         job
      )
   );
   onTestFinished(() => spy.mockRestore());

   const started = await shared.startConnect({ installId: install.id, action: 'connect', includeRisky: true });
   if (!started.ok) throw new Error(started.error.message);
   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed', result: { folders: 0 } });
});

test('bulk connect succeeds when another process has already repaired its planned link', async () => {
   const { installRoot, operations, shared, install } = await createBulkTestbed();
   const connected = await shared.startConnect({ installId: install.id, action: 'connect', includeRisky: true });
   if (!connected.ok) throw new Error(connected.error.message);
   expect(await waitForOperation(operations, connected.value.id)).toMatchObject({ status: 'completed' });
   const path = join(install.path, 'Custom/Replays');
   const target = await readlink(path);
   const foreign = join(installRoot, 'foreign');
   await mkdir(foreign);
   await rm(path);
   await symlink(foreign, path);
   const start = operations.start;
   const spy = vi.spyOn(operations, 'start').mockImplementation((input, run, job) =>
      start(
         input,
         async (id, signal) => {
            await rm(path);
            await symlink(target, path);
            return run(id, signal);
         },
         job
      )
   );
   onTestFinished(() => spy.mockRestore());

   const started = await shared.startConnect({ installId: install.id, action: 'connect', includeRisky: true });
   if (!started.ok) throw new Error(started.error.message);
   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed', result: { folders: 0 } });
});

test('bulk disconnect succeeds when another process has already unlinked its planned folders', async () => {
   const { operations, shared, install } = await createBulkTestbed();
   const connected = await shared.startConnect({ installId: install.id, action: 'connect', includeRisky: true });
   if (!connected.ok) throw new Error(connected.error.message);
   expect(await waitForOperation(operations, connected.value.id)).toMatchObject({ status: 'completed' });
   const preview = await shared.previewConnect({ installId: install.id, action: 'disconnect', includeRisky: true });
   if (preview.status !== 'ok') throw new Error(preview.issue);
   const start = operations.start;
   const spy = vi.spyOn(operations, 'start').mockImplementation((input, run, job) =>
      start(
         input,
         async (id, signal) => {
            for (const folder of preview.folders) {
               if (folder.step === 'skip') continue;
               const path = join(install.path, folder.relativePath);
               await rm(path);
               await mkdir(path, { recursive: true });
            }
            return run(id, signal);
         },
         job
      )
   );
   onTestFinished(() => spy.mockRestore());

   const started = await shared.startConnect({ installId: install.id, action: 'disconnect', includeRisky: true });
   if (!started.ok) throw new Error(started.error.message);
   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed', result: { folders: 0 } });
});

async function createBulkTestbed() {
   const testbed = await createInstallTestbed();
   const { installRoot, registry, settingsStore, operations, log, register } = testbed;
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const folderId = customSharedFolderId('Custom/Replays', 'Replays');
   await settingsStore.updateLibrarySettings({
      customFolders: [{ id: folderId, installRelativePath: 'Custom/Replays', libraryRelativePath: 'Replays' }]
   });
   return { ...testbed, shared, install };
}

test('bulk connect fails when only excluded risky folders remain', async () => {
   const { installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const request = { installId: install.id, action: 'connect' as const };
   const first = await shared.startConnect(request);
   if (!first.ok) throw new Error(first.error.message);
   expect(await waitForOperation(operations, first.value.id)).toMatchObject({ status: 'completed' });

   const second = await shared.startConnect(request);
   if (!second.ok) throw new Error(second.error.message);
   expect(await waitForOperation(operations, second.value.id)).toMatchObject({
      status: 'failed',
      error: { code: 'shared-content.nothing-to-connect' }
   });
});

test('unlinking a foreign link takes files from where it points, not the active library', async () => {
   const { dataPath, installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const foreign = join(dataPath, 'foreign');
   const active = join(installRoot, 'shared', 'Playlists');
   await mkdir(foreign);
   await mkdir(active, { recursive: true });
   await writeFile(join(foreign, 'wanted.bplist'), 'wanted');
   await writeFile(join(active, 'unrelated.bplist'), 'unrelated');
   await symlink(foreign, join(install.path, 'Playlists'));

   const started = await shared.start({ installId: install.id, folderId: 'playlists', action: 'unlink', contents: 'move' });
   if (!started.ok) throw new Error(started.error.message);

   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed' });
   expect(await readdir(join(install.path, 'Playlists'))).toEqual(['wanted.bplist']);
   expect(await readdir(foreign)).toEqual([]);
   expect(await readdir(active)).toEqual(['unrelated.bplist']);
});

test('a shared library that resolves to an install is refused', async () => {
   const { dataPath, installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   await symlink(install.path, join(dataPath, 'alias'));

   expect(await shared.addRoot({ path: join(dataPath, 'alias'), activate: true })).toEqual({ status: 'invalid', issue: 'root-inside-install' });
   expect(await shared.addRoot({ path: join(dataPath, 'alias', 'Shared'), activate: true })).toEqual({
      status: 'invalid',
      issue: 'root-inside-install'
   });

   const nested = await register(await writeInstallFolder(join(dataPath, 'library-root')));
   await settingsStore.updateLibrarySettings({ sharedRoot: join(nested.path, 'shared') });

   expect(await shared.preview({ installId: nested.id, folderId: 'playlists', action: 'link' })).toMatchObject({ issue: 'root-inside-install' });
});

test('a failed unlink copy keeps the folder linked', async () => {
   const { installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const sharedPlaylists = join(installRoot, 'shared', 'Playlists');
   await writePlaylist(install.path, 'one.bplist', 'one');
   await writePlaylist(install.path, 'two.bplist', 'two');
   const run = async (request: SharedContentActionRequest) => {
      const started = await shared.start(request);
      if (!started.ok) throw new Error(started.error.message);

      return waitForOperation(operations, started.value.id);
   };

   expect(await run({ installId: install.id, folderId: 'playlists', action: 'link' })).toMatchObject({ status: 'completed' });
   await chmod(join(sharedPlaylists, 'two.bplist'), 0o000);
   onTestFinished(() => chmod(join(sharedPlaylists, 'two.bplist'), 0o644));

   expect(await run({ installId: install.id, folderId: 'playlists', action: 'unlink', contents: 'move' })).toMatchObject({ status: 'failed' });
   expect(await readlink(join(install.path, 'Playlists'))).toBe(sharedPlaylists);
   expect((await readdir(install.path)).filter((name) => name.startsWith('.'))).toEqual([]);
   expect((await readdir(sharedPlaylists)).toSorted()).toEqual(['one.bplist', 'two.bplist']);
});

test('custom folders inside game folders are refused', async () => {
   const { installRoot, registry, settingsStore, operations, log, register } = await createInstallTestbed();
   const shared = createSharedContentService({ registry, settingsStore, operations, log, platform: 'linux' });
   onTestFinished(() => shared.dispose());
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   await mkdir(join(install.path, 'Beat Saber_Data', 'Managed'), { recursive: true });

   expect(await shared.addCustomFolder({ installId: install.id, relativePath: 'Beat Saber_Data/Managed' })).toMatchObject({ issue: 'unsafe-folder' });
});

async function writePlaylist(installPath: string, fileName: string, title: string) {
   await mkdir(join(installPath, 'Playlists'), { recursive: true });
   await writeFile(join(installPath, 'Playlists', fileName), JSON.stringify({ playlistTitle: title }), 'utf8');
}
