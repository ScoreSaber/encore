import { Result } from 'better-result';
import { afterEach, describe, expect, test } from 'vite-plus/test';

import { buildZipArchive } from '@/lib/archive/zip-read.fixture';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import type { BeatSaverCatalog, BeatSaverMapRecord, BeatSaverProblem } from '@/modules/maps/main/beatsaver-catalog';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { questInstallId } from '@/modules/quest/contract';
import { createFakeQuestDevices, createFakeQuestFs } from '@/modules/quest/main/quest-fs.fixture';
import { createQuestMapService } from '@/modules/quest/main/quest-map-service';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { questMapsDir } from '@/modules/quest/main/quest-paths';

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetId = 'quest:Q1SERIAL';
const request = { installId: questInstallId };
const beatmap = '{"_notes":[]}';
const info = JSON.stringify({
   _version: '2.0.0',
   _songName: 'Quest map',
   _songAuthorName: 'Artist',
   _levelAuthorName: 'Mapper',
   _difficultyBeatmapSets: [
      { _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [{ _difficulty: 'Expert', _beatmapFilename: 'Expert.dat' }] }
   ]
});
const directories: string[] = [];

afterEach(async () => {
   await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })));
});

describe('Quest maps', () => {
   test('rejects a downloaded map whose content disagrees with BeatSaver before writing to the headset', async () => {
      const { maps, remote, operations } = await setup();
      const started = await maps.startDownload(targetId, { ...request, source: { kind: 'beatsaver', key: 'a1' } });
      expect(Result.isOk(started)).toBe(true);
      await expect.poll(() => operations.listForTarget(targetId)[0]?.status).toBe('failed');
      expect(operations.listForTarget(targetId)[0]?.error?.code).toBe('maps.hash.mismatch');
      expect(remote.files.size).toBe(0);
   });

   test('shows the first map imported to a headset that had no map folder yet', async () => {
      const { maps } = await setup();
      expect((await maps.list(targetId, request)).status).toBe('missing');

      const archive = buildZipArchive([
         { name: 'Info.dat', data: info },
         { name: 'Expert.dat', data: beatmap }
      ]);
      const imported = await maps.importArchive(
         targetId,
         request,
         (async function* () {
            yield archive;
         })()
      );
      expect(Result.isOk(imported)).toBe(true);
      expect(await maps.list(targetId, request)).toMatchObject({ status: 'ready', maps: [{ title: 'Quest map' }] });
   });

   test('reuses the saved map list after a restart and only scans folders that changed', async () => {
      const dataPath = await mkdtemp(join(tmpdir(), 'encore-quest-maps-cache-'));
      directories.push(dataPath);
      const remote = createFakeQuestFs();
      const reads: string[] = [];
      const client = {
         ...remote.client,
         readTextFile: (serial: string, path: string) => {
            reads.push(path);
            return remote.client.readTextFile(serial, path);
         }
      };
      const mapsPath = questMapsDir('1.40.0');
      const addMap = (folder: string) => {
         remote.files.set(`${mapsPath}/${folder}/Info.dat`, Buffer.from(info));
         remote.files.set(`${mapsPath}/${folder}/Expert.dat`, Buffer.from(beatmap));
      };
      const start = () =>
         createQuestMapService({
            devices: createFakeQuestDevices(client),
            operations: createOperationRegistry(),
            ingestion: createContentIngestionService({ dataPath }),
            mutations: createQuestMutationLock(),
            dataPath
         });

      addMap('First');
      expect((await start().list(targetId, request)).maps.map((map) => map.folderName)).toEqual(['First']);
      await expect.poll(async () => (await readdir(dataPath)).some((name) => name.startsWith('quest-maps-'))).toBe(true);

      addMap('Second');
      reads.length = 0;
      expect((await start().list(targetId, request)).maps.map((map) => map.folderName).toSorted()).toEqual(['First', 'Second']);
      expect(reads).toEqual([`${mapsPath}/Second/Info.dat`]);
   });
});

async function setup() {
   const expectedHash = '0'.repeat(40);
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-quest-maps-test-'));
   directories.push(dataPath);
   const remote = createFakeQuestFs();
   const devices = createFakeQuestDevices(remote.client);
   const operations = createOperationRegistry();
   const record: BeatSaverMapRecord = {
      summary: {
         key: 'a1',
         hash: expectedHash,
         title: 'Quest map',
         subTitle: '',
         artist: 'Artist',
         mapper: 'Mapper',
         bpm: null,
         durationSeconds: null,
         upvotes: 0,
         downvotes: 0,
         ranked: false,
         curated: false,
         automapper: false,
         publishedAt: null,
         difficulties: [],
         coverUrl: null,
         installed: false
      },
      downloadUrl: 'https://cdn.beatsaver.com/a1.zip',
      listing: { url: 'https://beatsaver.com/maps/a1', description: '' }
   };
   const catalog: BeatSaverCatalog = {
      pageSize: 20,
      getByKey: async () => Result.ok<BeatSaverMapRecord, BeatSaverProblem>(record),
      search: async () => Result.ok<BeatSaverMapRecord[], BeatSaverProblem>([record]),
      getByHashes: async () => Result.ok(new Map([[expectedHash, record]]))
   };
   const archive = buildZipArchive([
      { name: 'Info.dat', data: info },
      { name: 'Expert.dat', data: beatmap }
   ]);
   const ingestion = createContentIngestionService({ dataPath, fetchContent: async () => new Response(archive) });
   return {
      remote,
      operations,
      maps: createQuestMapService({ devices, operations, ingestion, catalog, mutations: createQuestMutationLock(), dataPath })
   };
}
