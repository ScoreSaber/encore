import { Result } from 'better-result';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { buildZipArchive } from '@/lib/archive/zip-read.fixture';
import { defaultModSourceResolutionSettings, questModSourceId, questModSourceName } from '@/modules/mods/contract';
import { buildModIndex, modIndexKey, type ModIndexEntry } from '@/modules/mods/main/mod-index';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { questInstallId } from '@/modules/quest/contract';
import { createFakeQuestDevices, createFakeQuestFs } from '@/modules/quest/main/quest-fs.fixture';
import { createQuestModService } from '@/modules/quest/main/quest-mod-service';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import {
   questEarlyModsDir,
   questLateModsDir,
   questModDataDir,
   questPackagePath,
   questPackagesDir,
   questRecordsPath
} from '@/modules/quest/main/quest-paths';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
const coverPath = `${questModDataDir}/Mods/Qosmetics/cover.png`;
const emptyRepositories = { official: [], repositories: [], resolution: defaultModSourceResolutionSettings };

beforeAll(async () => {
   dir = await mkdtemp(join(tmpdir(), 'encore-quest-mods-test-'));
});

afterAll(async () => {
   await rm(dir, { recursive: true, force: true });
});

const archives = new Map([
   [
      'https://cdn.example.com/song-mod.qmod',
      buildZipArchive([
         {
            name: 'mod.json',
            data: JSON.stringify({
               id: 'song-mod',
               name: 'Song Mod',
               version: '1.2.0',
               modloader: 'Scotland2',
               modFiles: ['libsong.so'],
               fileCopies: [{ name: 'cover.png', destination: coverPath }],
               dependencies: [{ id: 'core-lib', version: '^1.0.0' }]
            })
         },
         { name: 'libsong.so', data: 'song-bytes' },
         { name: 'cover.png', data: 'png-bytes' }
      ])
   ],
   [
      'https://cdn.example.com/evil-mod.qmod',
      buildZipArchive([
         {
            name: 'mod.json',
            data: JSON.stringify({
               id: 'evil-mod',
               name: 'Evil Mod',
               version: '1.0.0',
               modloader: 'Scotland2',
               modFiles: ['libevil.so'],
               fileCopies: [{ name: 'evil.so', destination: '/data/adb/evil.so' }]
            })
         },
         { name: 'libevil.so', data: 'evil-bytes' },
         { name: 'evil.so', data: 'evil-bytes' }
      ])
   ],
   [
      'https://cdn.example.com/core-lib.qmod',
      buildZipArchive([
         {
            name: 'mod.json',
            data: JSON.stringify({ id: 'core-lib', name: 'Core Lib', version: '1.0.0', modloader: 'Scotland2', lateModFiles: ['libcore.so'] })
         },
         { name: 'libcore.so', data: 'core-bytes' }
      ])
   ]
]);

describe('quest mod service', () => {
   test('installs a mod with its dependency and uninstalls everything', async () => {
      const harness = createHarness();

      const finished = await harness.run(await harness.service.installMods({ ...harness.request, modIds: ['bsquest:song-mod'] }));
      expect(finished.status).toBe('completed');
      expect(harness.remote.files.has(`${questEarlyModsDir}/libsong.so`)).toBe(true);
      expect(harness.remote.files.has(`${questLateModsDir}/libcore.so`)).toBe(true);
      expect(harness.remote.files.has(coverPath)).toBe(true);

      const removed = await harness.run(await harness.service.uninstallMods({ ...harness.request, scope: 'all', modIds: [], externalIds: [] }));
      expect(removed.status).toBe('completed');
      expect(harness.remote.files.has(`${questEarlyModsDir}/libsong.so`)).toBe(false);
      expect(harness.remote.files.has(`${questLateModsDir}/libcore.so`)).toBe(false);
      expect(harness.remote.files.has(questPackagePath('song-mod'))).toBe(false);
      expect(harness.remote.files.has(coverPath)).toBe(false);
      expect(JSON.parse(harness.remote.files.get(questRecordsPath)?.toString() ?? '?')).toEqual([]);
   });

   test('refuses a qmod that copies outside the game mod data without writing anything', async () => {
      const harness = createHarness([questEntry('evil-mod', '1.0.0')]);

      const finished = await harness.run(await harness.service.installMods({ ...harness.request, modIds: ['bsquest:evil-mod'] }));
      expect(finished.error?.code).toBe('quest.install.unsafe-destination');
      expect(harness.remote.files.size).toBe(0);
   });

   test('reinstalls a dependency whose recorded files are gone and keeps records it cannot see', async () => {
      const harness = createHarness();
      const record = (id: string, files: string[]) => ({ id, name: id, version: '1.0.0', modId: null, files, packagePath: questPackagePath(id) });
      harness.remote.files.set(
         questRecordsPath,
         Buffer.from(JSON.stringify([record('core-lib', [`${questLateModsDir}/libcore.so`]), record('archived', [])]))
      );

      const finished = await harness.run(await harness.service.installMods({ ...harness.request, modIds: ['bsquest:song-mod'] }));
      expect(finished.status).toBe('completed');
      expect(harness.remote.files.get(`${questLateModsDir}/libcore.so`)?.toString()).toBe('core-bytes');
      expect(JSON.parse(harness.remote.files.get(questRecordsPath)?.toString() ?? '[]')).toMatchObject([
         { id: 'archived' },
         { id: 'song-mod' },
         { id: 'core-lib' }
      ]);
   });

   test('refuses a busy headset and unverified archives without touching it, then releases the lock', async () => {
      const harness = createHarness([{ ...questEntry('core-lib', '1.0.0'), archiveHash: { algorithm: 'sha256', value: 'a'.repeat(64) } }]);
      const held = harness.mutations.acquire(harness.request.targetId).unwrap();
      const busy = await harness.service.installMods({ ...harness.request, modIds: ['bsquest:core-lib'] });
      expect(busy.match({ ok: () => '', err: (error) => error.code })).toBe('quest.device.busy');
      held.release();

      const finished = await harness.run(await harness.service.installMods({ ...harness.request, modIds: ['bsquest:core-lib'] }));
      expect(finished.error?.code).toBe('content.hash.mismatch');
      expect(harness.remote.files.size).toBe(0);
      expect(Result.isOk(harness.mutations.acquire(harness.request.targetId))).toBe(true);
   });

   test('an interrupted update keeps the old files live, and a swap cut short reads as missing', async () => {
      const harness = createHarness();
      const first = `${questEarlyModsDir}/libfirst.so`;
      const second = `${questEarlyModsDir}/libsecond.so`;
      const importVersion = async (version: string) => {
         const sourcePath = join(dir, `split-${version}.qmod`);
         await writeFile(
            sourcePath,
            buildZipArchive([
               {
                  name: 'mod.json',
                  data: JSON.stringify({ id: 'split', name: 'Split', version, modloader: 'Scotland2', modFiles: ['libfirst.so', 'libsecond.so'] })
               },
               { name: 'libfirst.so', data: `first-${version}` },
               { name: 'libsecond.so', data: `second-${version}` }
            ])
         );
         return harness.run(await harness.service.importMod({ ...harness.request, sourcePath }));
      };
      expect((await importVersion('1.0.0')).status).toBe('completed');

      const { push, movePath } = harness.remote.client;
      harness.remote.client.push = async (serial, localPath, remotePath) =>
         localPath.endsWith('push-libsecond.so')
            ? Result.err({ code: 'android.adb.failed', message: 'connection lost' })
            : push(serial, localPath, remotePath);
      expect((await importVersion('2.0.0')).status).toBe('failed');
      expect([harness.remote.files.get(first)?.toString(), harness.remote.files.get(second)?.toString()]).toEqual(['first-1.0.0', 'second-1.0.0']);
      expect(await harness.service.getMods(harness.request)).toMatchObject({ external: [{ id: 'record:split', details: { version: '1.0.0' } }] });

      harness.remote.client.push = push;
      harness.remote.client.movePath = async (serial, from, to) =>
         to === second ? Result.err({ code: 'android.adb.failed', message: 'connection lost' }) : movePath(serial, from, to);
      expect((await importVersion('2.0.0')).status).toBe('failed');
      expect(harness.remote.files.has(second)).toBe(false);
      expect(await harness.service.getMods(harness.request)).toMatchObject({ external: [] });
   });

   test('a mod list read before an uninstall finishes is not reused afterward', async () => {
      const harness = createHarness();
      await harness.run(await harness.service.installMods({ ...harness.request, modIds: ['bsquest:song-mod'] }));

      const { listFiles } = harness.remote.client;
      let reached = () => {};
      let resume = () => {};
      const reading = new Promise<void>((resolve) => {
         reached = resolve;
      });
      const paused = new Promise<void>((resolve) => {
         resume = resolve;
      });
      harness.remote.client.listFiles = async (serial, path) => {
         if (path !== questPackagesDir) return listFiles(serial, path);
         harness.remote.client.listFiles = listFiles;
         reached();
         await paused;
         return listFiles(serial, path);
      };
      const stale = harness.service.getMods(harness.request);
      await reading;

      await harness.run(await harness.service.uninstallMods({ ...harness.request, scope: 'all', modIds: [], externalIds: [] }));
      resume();
      await stale;
      const snapshot = await harness.service.getMods(harness.request);
      expect(snapshot.status === 'ready' && snapshot.mods.find((mod) => mod.modId === 'bsquest:song-mod')?.installedVersion).toBeNull();
   });

   test('refuses to change mods when the installed mod list cannot be read', async () => {
      const harness = createHarness();
      harness.remote.files.set(questRecordsPath, Buffer.from('[]'));
      harness.remote.client.readTextFile = async () => Result.err({ code: 'android.adb.failed', message: 'offline' });

      expect(await harness.service.getMods(harness.request)).toMatchObject({ status: 'unavailable', issue: 'inspect-failed' });
      const started = await harness.service.installMods({ ...harness.request, modIds: ['bsquest:core-lib'] });
      expect(started.match({ ok: () => '', err: (error) => error.code })).toBe('quest.mods.inspect-failed');
      expect(harness.remote.files.get(questRecordsPath)?.toString()).toBe('[]');
   });
});

function createHarness(entries = [questEntry('song-mod', '1.2.0'), questEntry('core-lib', '1.0.0')]) {
   const remote = createFakeQuestFs();
   const operations = createOperationRegistry();
   const mutations = createQuestMutationLock();
   const index = buildModIndex({
      gameVersion: '1.40.0',
      platform: 'quest',
      source: 'cache',
      updatedAt: new Date().toISOString(),
      sources: [],
      entries
   });
   const service = createQuestModService({
      devices: createFakeQuestDevices(remote.client),
      operations,
      catalog: { get: async () => Result.ok(index), refresh: async () => Result.ok(index) },
      repositories: {
         sync: async () => ({ snapshot: emptyRepositories, failures: [] }),
         refresh: async () => emptyRepositories,
         checkDownloadHost: async () => Result.ok(undefined),
         listEntries: async () => ({ sources: [], entries: [], fileMatches: [], resolution: defaultModSourceResolutionSettings }),
         isQuestModsEnabled: async () => true
      },
      download: async ({ url, destinationPath }) => {
         const archive = archives.get(url);
         if (!archive) return Result.err({ code: 'content.download.http-error', message: `no fixture for ${url}` });

         await writeFile(destinationPath, archive);
         return Result.ok({ bytes: archive.length });
      },
      stagingRoot: dir,
      mutations
   });

   return {
      service,
      remote,
      mutations,
      request: { targetId: 'quest:Q1SERIAL', installId: questInstallId },
      run: (started: Awaited<ReturnType<typeof service.installMods>>) =>
         waitForOperation(operations, started.unwrap().id, { targetId: 'quest:Q1SERIAL' })
   };
}

function questEntry(packageId: string, version: string): ModIndexEntry {
   return {
      modId: modIndexKey(questModSourceId, packageId),
      packageId,
      sourceId: questModSourceId,
      sourceName: questModSourceName,
      sourceKind: 'official',
      name: packageId,
      summary: '',
      description: '',
      iconUrl: null,
      links: [],
      category: 'other',
      author: '',
      version,
      sizeBytes: null,
      isBsipa: false,
      claimedIdentity: null,
      dependencies: [],
      downloadUrl: `https://cdn.example.com/${packageId}.qmod`,
      downloadHost: 'cdn.example.com',
      archiveHash: null,
      files: []
   };
}
