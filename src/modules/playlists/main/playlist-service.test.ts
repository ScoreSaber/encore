import { Result } from 'better-result';
import { zipSync } from 'fflate';

import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import type { BeatSaverCatalog } from '@/modules/maps/main/beatsaver-catalog';
import { customLevelsPath } from '@/modules/maps/main/map-paths';
import { createMapService } from '@/modules/maps/main/map-service';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { playlistsPath } from '@/modules/playlists/main/playlist-paths';
import { createPlaylistService } from '@/modules/playlists/main/playlist-service';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

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

describe('playlist service', () => {
   test('loads full song details only when a playlist is opened', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      await writePlaylist(install.path, 'detail.bplist', {
         playlistTitle: 'Detail',
         songs: [{ hash: '0123456789abcdef0123456789abcdef01234567', songName: 'One song', levelAuthorName: 'Mapper' }]
      });
      await harness.playlists.list({ installId: install.id });

      const detail = await harness.playlists.getDetail({ installId: install.id, playlistId: 'detail.bplist' });

      expect(detail?.songs).toHaveLength(1);
      expect(detail?.songs[0]?.songName).toBe('One song');
   });

   test('deletes maps only when the playlist request asks for them', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      const hash = await harness.installMap(install.id, install.path);
      await writePlaylist(install.path, 'keep-maps.bplist', { playlistTitle: 'Keep maps', songs: [{ hash }] });
      await writePlaylist(install.path, 'drop-maps.bplist', { playlistTitle: 'Drop maps', songs: [{ hash }] });
      await harness.playlists.list({ installId: install.id });

      const playlistOnly = await harness.playlists.startDelete({
         installId: install.id,
         playlistIds: ['keep-maps.bplist']
      });
      expect(playlistOnly.ok).toBe(true);
      if (!playlistOnly.ok) return;

      expect((await waitForOperation(harness.operations, playlistOnly.value.id))?.status).toBe('completed');
      expect(await readdir(playlistsPath(install.path))).toEqual(['drop-maps.bplist']);
      expect(await readdir(customLevelsPath(install.path))).toHaveLength(1);

      const withMaps = await harness.playlists.startDelete({
         installId: install.id,
         playlistIds: ['drop-maps.bplist'],
         deleteMaps: true
      });
      expect(withMaps.ok).toBe(true);
      if (!withMaps.ok) return;

      expect((await waitForOperation(harness.operations, withMaps.value.id))?.status).toBe('completed');
      expect(await readdir(playlistsPath(install.path))).toEqual([]);
      expect(await readdir(customLevelsPath(install.path))).toEqual([]);
   });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-playlist-service-'));
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
   const catalog: BeatSaverCatalog = {
      search: () => Promise.resolve(Result.ok([])),
      getByKey: () => Promise.resolve(Result.err({ issue: 'fetch-failed' })),
      getByHashes: () => Promise.resolve(Result.ok(new Map())),
      pageSize: 20
   };
   const maps = createMapService({ registry, operations, dataPath, catalog });
   const playlists = createPlaylistService({ registry, operations, maps, dataPath });

   cleanups.push(async () => {
      playlists.dispose();
      maps.dispose();
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      operations,
      maps,
      playlists,
      firstInstall: async () => (await registry.list()).installs[0]!,
      installMap: async (installId: string, installPath: string) => {
         const archivePath = await writeMapArchive(dataPath, `${installId}.zip`, 'Reality Check');
         const started = await maps.startImport({ installId, paths: [archivePath] });
         if (!started.ok) throw new Error('the test map could not be imported');

         await waitForOperation(operations, started.value.id);
         expect(await readdir(customLevelsPath(installPath))).toHaveLength(1);

         return (await maps.list({ installId })).maps[0]?.hash ?? '';
      }
   };
}

async function createInstallFolder(parentPath: string, name: string) {
   const installPath = join(parentPath, name);
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');

   return installPath;
}

async function writePlaylist(installPath: string, fileName: string, document: unknown) {
   const rootPath = playlistsPath(installPath);
   await mkdir(rootPath, { recursive: true });
   await writeFile(join(rootPath, fileName), typeof document === 'string' ? document : JSON.stringify(document), 'utf8');
}

async function writeMapArchive(parentPath: string, fileName: string, title: string) {
   const rawInfo = JSON.stringify({
      _version: '2.0.0',
      _songName: title,
      _songAuthorName: 'Artist',
      _levelAuthorName: 'Mapper',
      _beatsPerMinute: 160,
      _songFilename: 'song.egg',
      _difficultyBeatmapSets: [
         { _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [{ _difficulty: 'Expert', _beatmapFilename: 'Expert.dat' }] }
      ]
   });

   const archivePath = join(parentPath, fileName);
   await writeFile(archivePath, zipSync({ 'Info.dat': encode(rawInfo), 'Expert.dat': encode('{"_notes":[]}'), 'song.egg': encode('song') }));

   return archivePath;
}

function encode(value: string) {
   return new TextEncoder().encode(value);
}
