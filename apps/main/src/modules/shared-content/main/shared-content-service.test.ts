import { expect, onTestFinished, test } from 'vite-plus/test';

import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import type { SharedContentActionRequest } from '@/modules/shared-content/contract';
import { createSharedContentService } from '@/modules/shared-content/main/shared-content-service';
import { customSharedFolderId } from '@/modules/shared-content/main/shared-library';

import { chmod, mkdir, readdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
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
