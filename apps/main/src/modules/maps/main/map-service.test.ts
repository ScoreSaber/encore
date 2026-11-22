import { Result } from 'better-result';
import { zipSync } from 'fflate';
import { expect, onTestFinished, test } from 'vite-plus/test';

import { implementApi } from '@/lib/api';
import { createSecretStore } from '@/lib/security/secret-store';
import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { mapsApi } from '@/modules/maps/api';
import { customLevelsPath } from '@/modules/maps/main/map-paths';
import { createMapService } from '@/modules/maps/main/map-service';
import { createMapSyncService } from '@/modules/maps/main/map-sync';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createRemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { createRemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import { localTargetId } from '@/modules/targets/contract';
import { createTargetRegistry } from '@/modules/targets/main/target-registry';

import { createHash } from 'node:crypto';
import { mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('refuses a download that does not match the BeatSaver hash and deletes only the selected map', async () => {
   const { dataPath, installRoot, registry, operations, log, register } = await createInstallTestbed();
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const mapsPath = customLevelsPath(install.path);
   await mkdir(join(mapsPath, 'Keep'), { recursive: true });
   await writeFile(join(mapsPath, 'Keep', 'Info.dat'), mapInfo('Keep'));
   await writeFile(join(mapsPath, 'Keep', 'Expert.dat'), difficulty);
   await writeFile(join(mapsPath, 'Keep', 'song.egg'), 'song');

   let served = mapArchive('Swapped Map');
   const record = catalogRecord(createHash('sha1').update(mapInfo('Reality Check')).update(difficulty).digest('hex'));
   const maps = createMapService({
      registry,
      operations,
      dataPath,
      log,
      fetchContent: () => Promise.resolve(new Response(served)),
      catalog: {
         search: () => Promise.resolve(Result.ok([record])),
         getByKey: () => Promise.resolve(Result.ok(record)),
         getByHashes: () => Promise.resolve(Result.ok(new Map())),
         pageSize: 20
      }
   });
   onTestFinished(() => maps.dispose());
   const run = async (started: Awaited<ReturnType<typeof maps.startDelete>>) => {
      if (!started.ok) throw new Error('the map operation did not start');

      return waitForOperation(operations, started.value.id);
   };
   const download = () => maps.startDownload({ installId: install.id, source: { kind: 'beatsaver', key: '2a1b' } });

   expect(await run(await download())).toMatchObject({ status: 'failed', error: { code: 'maps.hash.mismatch' } });
   expect(await readdir(mapsPath)).toEqual(['Keep']);

   served = mapArchive('Reality Check');
   expect(await run(await download())).toMatchObject({ status: 'completed' });
   const downloaded = (await maps.list({ installId: install.id })).maps.find((map) => map.title === 'Reality Check');
   if (!downloaded) throw new Error('the downloaded map was not scanned');

   expect(await run(await maps.startDelete({ installId: install.id, mapIds: [downloaded.id] }))).toMatchObject({ status: 'completed' });
   expect(await readdir(mapsPath)).toEqual(['Keep']);
});

test('syncs one copy of each map both ways between two installs through the target registry', async () => {
   const { dataPath, installRoot, settingsStore, registry, operations, log, register } = await createInstallTestbed();
   const first = await register(await writeInstallFolder(join(installRoot, 'First')));
   const second = await register(await writeInstallFolder(join(installRoot, 'Second')));
   await writeMap(customLevelsPath(first.path), 'Reality Check');
   await writeMap(customLevelsPath(first.path), 'Reality Check', 'Reality Check (copy)');
   await writeMap(customLevelsPath(second.path), 'Second Song');
   const maps = createMapService({ registry, operations, dataPath, log });
   onTestFinished(() => maps.dispose());
   const secretStore = createSecretStore({
      dataPath,
      platform: 'linux',
      protection: {
         isEncryptionAvailable: () => true,
         getSelectedStorageBackend: () => 'gnome_libsecret',
         encryptString: (plainText) => Buffer.from(plainText),
         decryptString: (encrypted) => encrypted.toString()
      }
   });
   const targets = createTargetRegistry({
      local: [
         implementApi(mapsApi, maps, {
            subscribe: maps.subscribe,
            uploads: { importArchive: maps.importArchive },
            downloads: { exportArchive: maps.exportArchive }
         })
      ],
      remote: createRemoteReceiverClient({ store: createRemoteTargetStore({ settingsStore, secretStore }) })
   });
   const sync = createMapSyncService({ registry: targets, operations, stagingRoot: join(dataPath, 'map-sync') });
   const request = { first: { targetId: localTargetId, installId: first.id }, second: { targetId: localTargetId, installId: second.id } };
   const titles = async (installId: string) => (await maps.list({ installId })).maps.map((map) => map.title).toSorted();

   expect(await sync.preview(request)).toEqual({ toFirst: 1, toSecond: 1, problem: null, runsOn: null });
   const started = (await sync.start(request)).unwrap();
   expect(await waitForOperation(operations, started.operation.id)).toMatchObject({ status: 'completed', result: { mapCount: 2, failed: 0 } });
   expect(await titles(first.id)).toEqual(['Reality Check', 'Reality Check', 'Second Song']);
   expect(await titles(second.id)).toEqual(['Reality Check', 'Second Song']);
   expect(await sync.preview(request)).toEqual({ toFirst: 0, toSecond: 0, problem: null, runsOn: null });
});

test('a map deleted through one install leaves the list of another install sharing its folder', async () => {
   const { dataPath, installRoot, registry, operations, log, register } = await createInstallTestbed();
   const first = await register(await writeInstallFolder(join(installRoot, 'First')));
   const second = await register(await writeInstallFolder(join(installRoot, 'Second')));
   await writeMap(customLevelsPath(first.path), 'Keep');
   await writeMap(customLevelsPath(first.path), 'Delete Me');
   await symlink(customLevelsPath(first.path), customLevelsPath(second.path), 'dir');
   const maps = createMapService({ registry, operations, dataPath, log });
   onTestFinished(() => maps.dispose());

   await maps.list({ installId: second.id });
   const deleted = (await maps.list({ installId: first.id })).maps.find((map) => map.title === 'Delete Me');
   if (!deleted) throw new Error('the map was not scanned');
   const started = await maps.startDelete({ installId: first.id, mapIds: [deleted.id] });
   if (!started.ok) throw new Error('the delete did not start');
   expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed' });

   expect((await maps.list({ installId: second.id })).maps.map((map) => map.title)).toEqual(['Keep']);
});

async function writeMap(mapsPath: string, title: string, folderName = title) {
   const mapPath = join(mapsPath, folderName);
   await mkdir(mapPath, { recursive: true });
   await writeFile(join(mapPath, 'Info.dat'), mapInfo(title));
   await writeFile(join(mapPath, 'Expert.dat'), difficulty);
   await writeFile(join(mapPath, 'song.egg'), 'song');
}

const difficulty = '{"_notes":[]}';

function mapInfo(title: string) {
   return JSON.stringify({
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
}

function mapArchive(title: string) {
   const encoder = new TextEncoder();

   return zipSync({ 'Info.dat': encoder.encode(mapInfo(title)), 'Expert.dat': encoder.encode(difficulty), 'song.egg': encoder.encode('song') });
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
      listing: { url: 'https://beatsaver.com/maps/2a1b', description: '' }
   };
}
