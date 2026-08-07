import { Result } from 'better-result';
import { zipSync } from 'fflate';

import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import type { BeatSaverCatalog } from '@/modules/maps/main/beatsaver-catalog';
import { customLevelsPath } from '@/modules/maps/main/map-paths';
import { createMapService } from '@/modules/maps/main/map-service';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('map service', () => {
   test('returns requested map covers without leaking missing entries', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      const mapPath = join(customLevelsPath(install.path), 'Reality Check');
      await mkdir(mapPath, { recursive: true });
      await writeFile(join(mapPath, 'Info.dat'), rawMapInfo('Reality Check', 'cover.png'));
      await writeFile(join(mapPath, 'Expert.dat'), difficultyData);
      await writeFile(join(mapPath, 'song.egg'), 'song');
      await writeFile(join(mapPath, 'cover.png'), 'cover');

      const snapshot = await harness.maps.list({ installId: install.id });
      const mapId = snapshot.maps[0]!.id;

      expect(await harness.maps.getCovers({ installId: install.id, mapIds: [mapId, 'missing'] })).toEqual({
         covers: [{ mapId, dataUrl: 'data:image/png;base64,Y292ZXI=' }],
         deferredMapIds: []
      });
   });

   test('defers cover art that would overflow one remote response', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      const cover = new Uint8Array((5 * 1024 * 1024) / 2);

      for (const title of ['First', 'Second']) {
         const mapPath = join(customLevelsPath(install.path), title);
         await mkdir(mapPath, { recursive: true });
         await writeFile(join(mapPath, 'Info.dat'), rawMapInfo(title, 'cover.png'));
         await writeFile(join(mapPath, 'Expert.dat'), difficultyData);
         await writeFile(join(mapPath, 'song.egg'), 'song');
         await writeFile(join(mapPath, 'cover.png'), cover);
      }

      const snapshot = await harness.maps.list({ installId: install.id });
      const mapIds = snapshot.maps.map((map) => map.id);
      const result = await harness.maps.getCovers({ installId: install.id, mapIds });

      expect(result.covers).toHaveLength(1);
      expect(result.deferredMapIds).toHaveLength(1);
      expect(new Set([...result.covers.map((entry) => entry.mapId), ...result.deferredMapIds])).toEqual(new Set(mapIds));
   });

   test('reuses an indexed map folder shared by another install', async () => {
      const harness = await createHarness();
      const first = await harness.firstInstall();
      const second = await harness.addInstall('Beat Saber 1.38');
      const sharedMapsPath = join(harness.dataPath, 'shared-maps');
      const mapPath = join(sharedMapsPath, 'Reality Check');
      await mkdir(mapPath, { recursive: true });
      await writeFile(join(mapPath, 'Info.dat'), rawMapInfo('Reality Check'));
      await writeFile(join(mapPath, 'Expert.dat'), difficultyData);
      await writeFile(join(mapPath, 'song.egg'), 'song');
      await symlink(sharedMapsPath, customLevelsPath(first.path), 'dir');
      await symlink(sharedMapsPath, customLevelsPath(second.path), 'dir');

      await harness.maps.list({ installId: first.id });
      const published = [] as { installId: string; progress: { scanned: number; total: number } | null }[];
      const unsubscribe = harness.maps.subscribe((snapshot) => published.push(snapshot));

      const snapshot = await harness.maps.list({ installId: second.id });
      unsubscribe();

      expect(snapshot.maps.map((map) => map.title)).toEqual(['Reality Check']);
      expect(snapshot.maps[0]?.path).toBe(join(customLevelsPath(second.path), 'Reality Check'));
      expect(published.filter((entry) => entry.installId === second.id && entry.progress !== null)).toEqual([]);
   });

   test('imports and deletes one map while keeping the snapshot in sync', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      const archivePath = await writeMapArchive(harness.dataPath, 'reality-check.zip', 'Reality Check');

      const started = await harness.maps.startImport({ installId: install.id, paths: [archivePath] });

      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);
      expect(finished?.status).toBe('completed');

      const snapshot = await harness.maps.list({ installId: install.id });
      expect(snapshot.maps.map((map) => map.title)).toEqual(['Reality Check']);
      expect(await readdir(customLevelsPath(install.path))).toEqual(['Reality Check - Artist - Mapper']);

      const deleted = await harness.maps.startDelete({ installId: install.id, mapIds: [snapshot.maps[0]!.id] });
      expect(deleted.ok).toBe(true);
      if (!deleted.ok) return;

      expect((await waitForOperation(harness.operations, deleted.value.id))?.status).toBe('completed');
      expect((await harness.maps.list({ installId: install.id })).maps).toEqual([]);
      expect(await readdir(customLevelsPath(install.path))).toEqual([]);
   });

   test('refuses a second copy of a map that is already installed', async () => {
      const harness = await createHarness();
      const install = await harness.firstInstall();
      const archivePath = await writeMapArchive(harness.dataPath, 'reality-check.zip', 'Reality Check');

      const first = await harness.maps.startImport({ installId: install.id, paths: [archivePath] });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      await waitForOperation(harness.operations, first.value.id);

      const second = await harness.maps.startImport({ installId: install.id, paths: [archivePath] });
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      const finished = await waitForOperation(harness.operations, second.value.id);
      expect(finished?.status).toBe('failed');
      expect(await readdir(customLevelsPath(install.path))).toHaveLength(1);
   });

   test('refuses a downloaded archive whose contents do not match the hash BeatSaver published', async () => {
      const harness = await createHarness({ fetchContent: () => Promise.resolve(new Response(buildMapArchive('Swapped Map'))) });
      const install = await harness.firstInstall();
      harness.setCatalogHash(mapArchiveHash('Reality Check'));

      const started = await harness.maps.startDownload({
         installId: install.id,
         source: { kind: 'beatsaver', key: '2a1b' }
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      const finished = await waitForOperation(harness.operations, started.value.id);

      expect(finished?.status).toBe('failed');
      expect(finished?.error?.code).toBe('maps.hash.failed');
      expect(await readdir(customLevelsPath(install.path)).catch(() => [])).toEqual([]);
   });
});

async function createHarness(options: { fetchContent?: ContentFetch } = {}) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-map-service-'));
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
   let catalogHash = 'a1b2c3';
   const catalog: BeatSaverCatalog = {
      search: () => Promise.resolve(Result.ok([catalogRecord(catalogHash)])),
      getByKey: () => Promise.resolve(Result.ok(catalogRecord(catalogHash))),
      getByHashes: (hashes) => Promise.resolve(Result.ok(new Map(hashes.map((hash) => [hash, catalogRecord(hash)])))),
      pageSize: 20
   };
   const maps = createMapService({
      registry,
      operations,
      dataPath,
      catalog,
      ...(options.fetchContent ? { ingestion: createContentIngestionService({ dataPath, fetchContent: options.fetchContent }) } : {})
   });

   cleanups.push(async () => {
      maps.dispose();
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      operations,
      maps,
      firstInstall: async () => (await registry.list()).installs[0]!,
      addInstall: async (name: string) => {
         const path = await createInstallFolder(installRoot, name);
         await registry.register({ source: 'library', path });
         return (await registry.list()).installs.find((install) => install.path === path)!;
      },
      setCatalogHash: (hash: string) => {
         catalogHash = hash;
      }
   };
}

function catalogRecord(hash: string) {
   return {
      summary: {
         key: '2a1b',
         hash,
         title: 'Reality Check',
         subTitle: '',
         artist: 'Artist',
         mapper: 'Mapper',
         bpm: 174,
         durationSeconds: 210,
         upvotes: 10,
         downvotes: 0,
         ranked: false,
         curated: false,
         automapper: false,
         publishedAt: null,
         difficulties: [],
         coverUrl: null,
         installed: false
      },
      downloadUrl: 'https://cdn.beatsaver.com/a1b2c3.zip',
      listing: {
         url: 'https://beatsaver.com/maps/2a1b',
         description: ''
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

async function writeMapArchive(parentPath: string, fileName: string, title: string) {
   const archivePath = join(parentPath, fileName);
   await writeFile(archivePath, buildMapArchive(title));

   return archivePath;
}

const difficultyData = '{"_notes":[]}';

function buildMapArchive(title: string) {
   return zipSync({ 'Info.dat': encode(rawMapInfo(title)), 'Expert.dat': encode(difficultyData), 'song.egg': encode('song') });
}

function mapArchiveHash(title: string) {
   return createHash('sha1').update(rawMapInfo(title)).update(difficultyData).digest('hex');
}

function rawMapInfo(title: string, coverFileName?: string) {
   return JSON.stringify({
      _version: '2.0.0',
      _songName: title,
      _songAuthorName: 'Artist',
      _levelAuthorName: 'Mapper',
      _beatsPerMinute: 160,
      _songFilename: 'song.egg',
      ...(coverFileName ? { _coverImageFilename: coverFileName } : {}),
      _difficultyBeatmapSets: [
         { _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [{ _difficulty: 'Expert', _beatmapFilename: 'Expert.dat' }] }
      ]
   });
}

function encode(value: string) {
   return new TextEncoder().encode(value);
}
