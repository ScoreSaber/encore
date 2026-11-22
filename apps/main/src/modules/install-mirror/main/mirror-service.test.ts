import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { createMirrorService, type MirrorRemote } from '@/modules/install-mirror/main/mirror-service';
import { createMirrorSource } from '@/modules/install-mirror/main/mirror-source';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import type { SteamClientState } from '@/modules/stores/main/steam-client';

import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

test('mirrors an install with its shared maps and appdata over this device, then syncs only what changed', async () => {
   const { pcInstall, pcShared, frameShared, frameAppData, oldInstall, destination, frame, mirror, run } = await createHarness();

   expect(Result.isError(await mirror.start({ ...request, planKey: 'unseen' }))).toBe(true);
   expect(await readdir(frame.installRoot)).toEqual(expect.arrayContaining(['Beat Saber 1.37.0']));
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };

   expect(await run()).toMatchObject({ status: 'completed' });
   expect(await readFile(join(destination, 'Plugins', 'SongCore.dll'), 'utf8')).toBe('songcore');
   expect((await readFile(join(destination, 'Beat Saber_Data', 'sharedassets0.assets'))).byteLength).toBe(5 * 1024 * 1024);
   expect(await readlink(join(destination, 'Beat Saber_Data', 'CustomLevels'))).toBe(join(frameShared, 'SharedMaps', 'CustomLevels'));
   expect((await readdir(join(frameShared, 'SharedMaps', 'CustomLevels'))).sort()).toEqual(['Map One']);
   expect(await readFile(join(frameAppData, 'PlayerData.dat'), 'utf8')).toBe('player');
   expect((await frame.registry.list()).installs).toMatchObject([{ path: destination, color: '#3b82f6' }]);
   expect(await lstat(oldInstall).catch(() => null)).toBeNull();
   expect((await frame.settingsStore.getSnapshot()).library.mirrors).toMatchObject([{ targetId: 'remote_zhu', path: destination }]);

   await writeFile(join(pcInstall, 'Plugins', 'SongCore.dll'), 'songcore v2');
   await rm(join(pcShared, 'SharedMaps', 'CustomLevels', 'Map One'), { recursive: true });
   await writeFile(join(destination, 'Plugins', 'Leftover.dll'), 'only on the frame');

   expect(await run()).toMatchObject({ status: 'completed' });
   expect(await readFile(join(destination, 'Plugins', 'SongCore.dll'), 'utf8')).toBe('songcore v2');
   expect(await readdir(join(destination, 'Plugins'))).toEqual(['SongCore.dll']);
   expect(await readdir(join(frameShared, 'SharedMaps', 'CustomLevels'))).toEqual([]);
});

test('copies several versions at once with the maps they share copied a single time', async () => {
   const { pc, pcShared, frame, frameShared, mirror } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   const older = await writeInstallFolder(join(pc.installRoot, 'Beat Saber 1.37.1'), '1.37.1');
   await symlink(join(pcShared, 'SharedMaps', 'CustomLevels'), join(older, 'Beat Saber_Data', 'CustomLevels'), 'dir');
   const registered = await pc.registry.register({ source: 'library', path: older, store: 'steam' });
   if (Result.isError(registered)) throw new Error('second source registration failed');

   const both = { ...request, sourceInstallIds: [...request.sourceInstallIds, registered.value.id] };
   const previewed = await mirror.preview(both);
   if (Result.isError(previewed)) throw new Error(previewed.error.message);
   const started = await mirror.start({ ...both, planKey: previewed.value.planKey });
   if (Result.isError(started)) throw new Error(started.error.message);
   expect(await waitForOperation(frame.operations, started.value.id)).toMatchObject({ status: 'completed' });

   const shared = join(frameShared, 'SharedMaps', 'CustomLevels');
   for (const version of ['1.40.8', '1.37.1']) {
      expect(await readlink(join(frame.installRoot, `Beat Saber ${version}`, 'Beat Saber_Data', 'CustomLevels'))).toBe(shared);
   }
   expect(await readdir(shared)).toEqual(['Map One']);
   expect((await frame.settingsStore.getSnapshot()).library.mirrors.map((record) => record.path).sort()).toEqual(
      ['Beat Saber 1.37.1', 'Beat Saber 1.40.8'].map((name) => join(frame.installRoot, name))
   );
});

test('a source folder it cannot read stops the mirror before anything on this device changes', async () => {
   const { pcInstall, frameShared, oldInstall, frame, run } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   await chmod(join(pcInstall, 'Plugins'), 0o000);

   const finished = await run();
   await chmod(join(pcInstall, 'Plugins'), 0o755);
   expect(finished).toMatchObject({ status: 'failed', error: { code: 'mirror.source-unreadable' } });
   expect(await readdir(join(frameShared, 'SharedMaps', 'CustomLevels'))).toEqual(['Frame Only Map']);
   expect((await frame.registry.list()).installs.map((install) => install.path)).toEqual([oldInstall]);
});

test('a commit that fails part way puts back every file it already replaced', async () => {
   const { pcInstall, destination, run } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   expect(await run()).toMatchObject({ status: 'completed' });

   await writeFile(join(pcInstall, 'Beat Saber_Data', 'sharedassets0.assets'), 'newer assets');
   await writeFile(join(pcInstall, 'Plugins', 'SongCore.dll'), 'songcore v2');
   await chmod(join(destination, 'Plugins'), 0o555);

   const finished = await run();
   await chmod(join(destination, 'Plugins'), 0o755);
   expect(finished).toMatchObject({ status: 'failed' });
   expect((await readFile(join(destination, 'Beat Saber_Data', 'sharedassets0.assets'))).byteLength).toBe(5 * 1024 * 1024);
   expect(await readFile(join(destination, 'Plugins', 'SongCore.dll'), 'utf8')).toBe('songcore');
   expect((await readdir(destination)).filter((name) => name.startsWith('.encore-'))).toEqual([]);
});

test('a folder holding an empty folder becomes a file', async () => {
   const { pcInstall, destination, run } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   await mkdir(join(pcInstall, 'Plugins', 'Pack', 'empty'), { recursive: true });
   await writeFile(join(pcInstall, 'Plugins', 'Pack', 'child'), 'inside');
   expect(await run()).toMatchObject({ status: 'completed' });
   await mkdir(join(destination, 'Plugins', 'Pack', 'empty'), { recursive: true });

   await rm(join(pcInstall, 'Plugins', 'Pack'), { recursive: true });
   await writeFile(join(pcInstall, 'Plugins', 'Pack'), 'now a file');
   expect(await run()).toMatchObject({ status: 'completed' });
   expect(await readFile(join(destination, 'Plugins', 'Pack'), 'utf8')).toBe('now a file');
});

test('rolling back a file that became a folder brings the file back', async () => {
   const { pcInstall, pcAppData, frameAppData, destination, run } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   expect(await run()).toMatchObject({ status: 'completed' });

   await rm(join(pcInstall, 'Plugins', 'SongCore.dll'));
   await mkdir(join(pcInstall, 'Plugins', 'SongCore.dll'));
   await writeFile(join(pcInstall, 'Plugins', 'SongCore.dll', 'child'), 'now a folder');
   await mkdir(join(pcAppData, 'Saves'));
   await writeFile(join(pcAppData, 'Saves', 'slot.dat'), 'save');
   await mkdir(join(frameAppData, 'Saves'));
   await chmod(join(frameAppData, 'Saves'), 0o555);

   const finished = await run();
   await chmod(join(frameAppData, 'Saves'), 0o755);
   expect(finished).toMatchObject({ status: 'failed' });
   expect(await readFile(join(destination, 'Plugins', 'SongCore.dll'), 'utf8')).toBe('songcore');
   expect(await readdir(join(frameAppData, 'Saves'))).toEqual([]);
});

test('a link out of the install serves nothing from beyond it', async () => {
   const { pc, pcInstall, source } = await createHarness();
   const outside = join(pc.dataPath, 'private');
   await mkdir(outside);
   await writeFile(join(outside, 'secret.txt'), 'outside the install');
   await symlink(outside, join(pcInstall, 'Escape'), 'dir');
   const installId = request.sourceInstallIds[0] ?? '';

   expect(await source.manifest({ installId, section: { kind: 'install' }, offset: 0 })).toMatchObject({
      error: { code: 'mirror.source-unreadable' }
   });
   expect(Result.isError(await source.readFile({ installId, section: { kind: 'install' }, path: 'Escape/secret.txt' }))).toBe(true);
   expect(
      Result.isError(await source.readBatch({ installId, section: { kind: 'install' }, paths: ['Plugins/SongCore.dll', 'Escape/secret.txt'] }))
   ).toBe(true);
});

test('a source without appdata leaves the saves on this device alone', async () => {
   const { pcAppData, frameAppData, run } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   await rm(pcAppData, { recursive: true });
   await mkdir(frameAppData, { recursive: true });
   await writeFile(join(frameAppData, 'PlayerData.dat'), 'frame save');

   expect(await run()).toMatchObject({ status: 'completed' });
   expect(await readFile(join(frameAppData, 'PlayerData.dat'), 'utf8')).toBe('frame save');
});

test('removing the other installs runs to the end once the copy is in place', async () => {
   const { oldInstall, frame, mirror } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   const previewed = await mirror.preview(request);
   if (Result.isError(previewed)) throw new Error(previewed.error.message);
   const cancels: Promise<unknown>[] = [];
   const unsubscribe = frame.operations.subscribe((snapshot) => {
      if (snapshot.status === 'running' && snapshot.progress?.phase === 'removing') cancels.push(frame.operations.cancel({ id: snapshot.id }));
   });
   const started = await mirror.start({ ...request, planKey: previewed.value.planKey });
   if (Result.isError(started)) throw new Error(started.error.message);

   expect(await waitForOperation(frame.operations, started.value.id)).toMatchObject({ status: 'completed' });
   unsubscribe();
   expect(await Promise.all(cancels)).toMatchObject([{ status: 'noop', reason: 'not-cancelable' }]);
   expect(await lstat(oldInstall).catch(() => null)).toBeNull();
});

test('copying one version keeps the other installs and never reuses a folder already there', async () => {
   const { oldInstall, frame, mirror } = await createHarness();
   steam = { status: 'ready', executablePath: '/bin/true', depotPath: '/nonexistent' };
   const occupied = join(frame.installRoot, 'Beat Saber 1.40.8');
   await mkdir(occupied);
   await writeFile(join(occupied, 'notes.txt'), 'not an install');
   const single = { sourceTargetId: request.sourceTargetId, sourceInstallIds: request.sourceInstallIds };

   const previewed = await mirror.preview(single);
   if (Result.isError(previewed)) throw new Error(previewed.error.message);
   expect(previewed.value).toMatchObject({ removals: [], installs: [{ destinationPath: join(frame.installRoot, 'Beat Saber 1.40.8 (2)') }] });
   const started = await mirror.start({ ...single, planKey: previewed.value.planKey });
   if (Result.isError(started)) throw new Error(started.error.message);

   expect(await waitForOperation(frame.operations, started.value.id)).toMatchObject({ status: 'completed' });
   expect(await readFile(join(occupied, 'notes.txt'), 'utf8')).toBe('not an install');
   expect((await frame.registry.list()).installs.map((install) => install.path).sort()).toEqual([oldInstall, `${occupied} (2)`].sort());
});

let steam: SteamClientState = { status: 'missing' };
const request = { sourceTargetId: 'remote_zhu', sourceInstallIds: [''], replaceOthers: true };

async function createHarness() {
   steam = { status: 'missing' };
   const pc = await createInstallTestbed();
   const frame = await createInstallTestbed();

   const pcInstall = await writeInstallFolder(join(pc.installRoot, 'Beat Saber 1.40.8'), '1.40.8');
   await mkdir(join(pcInstall, 'Plugins'), { recursive: true });
   await writeFile(join(pcInstall, 'Plugins', 'SongCore.dll'), 'songcore');
   await writeFile(join(pcInstall, 'Beat Saber_Data', 'sharedassets0.assets'), Buffer.alloc(5 * 1024 * 1024, 7));
   const pcShared = join(pc.dataPath, 'shared');
   await mkdir(join(pcShared, 'SharedMaps', 'CustomLevels', 'Map One'), { recursive: true });
   await writeFile(join(pcShared, 'SharedMaps', 'CustomLevels', 'Map One', 'Info.dat'), 'map one');
   await symlink(join(pcShared, 'SharedMaps', 'CustomLevels'), join(pcInstall, 'Beat Saber_Data', 'CustomLevels'), 'dir');
   const pcAppData = join(pc.dataPath, 'appdata');
   await mkdir(pcAppData, { recursive: true });
   await writeFile(join(pcAppData, 'PlayerData.dat'), 'player');
   const registered = await pc.registry.register({ source: 'library', path: pcInstall, store: 'steam' });
   if (Result.isError(registered)) throw new Error('source registration failed');
   await pc.registry.update(registered.value.id, { color: '#3b82f6' });
   request.sourceInstallIds = [registered.value.id];

   const frameShared = join(frame.installRoot, 'shared');
   const oldInstall = await writeInstallFolder(join(frame.installRoot, 'Beat Saber 1.37.0'));
   await mkdir(join(frameShared, 'SharedMaps', 'CustomLevels', 'Frame Only Map'), { recursive: true });
   await writeFile(join(frameShared, 'SharedMaps', 'CustomLevels', 'Frame Only Map', 'Info.dat'), 'frame only');
   await symlink(join(frameShared, 'SharedMaps', 'CustomLevels'), join(oldInstall, 'Beat Saber_Data', 'CustomLevels'), 'dir');
   await frame.register(oldInstall);

   const source = createMirrorSource({ installs: pc.registry, sharedRoots: () => Promise.resolve([pcShared]), appDataPath: pcAppData });
   const remote: MirrorRemote = {
      name: () => 'Zhu',
      detail: (_targetId, installId) => pc.registry.get(installId),
      manifest: (_targetId, manifestRequest) => source.manifest(manifestRequest),
      readFile: async (_targetId, fileRequest, destinationPath) => save(await source.readFile(fileRequest), destinationPath),
      readBatch: async (_targetId, batchRequest, destinationPath) => save(await source.readBatch(batchRequest), destinationPath)
   };
   const frameAppData = join(frame.dataPath, 'appdata');
   const mirror = createMirrorService({
      remote,
      installs: frame.registry,
      settingsStore: frame.settingsStore,
      operations: frame.operations,
      platform: 'linux',
      appDataPath: frameAppData,
      stagingRoot: join(frame.dataPath, 'staging'),
      readSteam: () => Promise.resolve(steam),
      openSteamLink: () => Promise.resolve(true),
      ensureProton: () => Promise.resolve(false)
   });
   const run = async () => {
      const previewed = await mirror.preview(request);
      if (Result.isError(previewed)) throw new Error(previewed.error.message);
      const started = await mirror.start({ ...request, planKey: previewed.value.planKey });
      if (Result.isError(started)) throw new Error(started.error.message);
      return waitForOperation(frame.operations, started.value.id);
   };

   return {
      pc,
      pcInstall,
      pcShared,
      pcAppData,
      frameShared,
      frameAppData,
      oldInstall,
      destination: join(frame.installRoot, 'Beat Saber 1.40.8'),
      frame,
      mirror,
      source,
      run
   };
}

async function save(opened: Result<AsyncIterable<Uint8Array>, unknown>, destinationPath: string) {
   if (Result.isError(opened)) return false;
   await pipeline(opened.value, createWriteStream(destinationPath));
   return true;
}
