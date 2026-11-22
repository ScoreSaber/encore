import { Result } from 'better-result';
import { unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import { androidNamespaceUri, serializeAxml, type AxmlEvent } from '@/lib/android/axml';
import type { Problem } from '@/lib/errors';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { beatSaberPackageId } from '@/modules/quest/contract';
import { createFakeQuestDevices, createFakeQuestFs, fakeQuestApkPath } from '@/modules/quest/main/quest-fs.fixture';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { createQuestPatchService, type QuestPatchServiceOptions } from '@/modules/quest/main/quest-patch-service';
import { questSavedPlayerDataPath, questScotland2Path } from '@/modules/quest/main/quest-paths';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetId = 'quest:Q1SERIAL';
const obbPath = `/sdcard/Android/obb/${beatSaberPackageId}/main.obb`;
const playerDataPath = `/sdcard/Android/data/${beatSaberPackageId}/files/PlayerData.dat`;
const keeperPath = `/sdcard/ModData/${beatSaberPackageId}/Mods/datakeeper/PlayerData.dat`;
const backupDir = '/data/local/tmp/encore-patch';

let dir: string;
let loaderDir: string;

beforeAll(async () => {
   dir = await mkdtemp(join(tmpdir(), 'encore-quest-patch-test-'));
   loaderDir = join(dir, 'loader');
   await mkdir(loaderDir, { recursive: true });
   await writeFile(join(loaderDir, 'libmain.so'), 'libmain-loader-bytes');
   await writeFile(join(loaderDir, 'libsl2.so'), 'scotland2-bytes');
});

afterAll(async () => {
   await rm(dir, { recursive: true, force: true });
});

describe('quest patching', () => {
   test('rewrites, signs and reinstalls the game, then restores songs, player data and the modloader', async () => {
      const harness = createHarness();
      harness.remote.files.set(obbPath, Buffer.from('song-data'));
      harness.remote.files.set(playerDataPath, Buffer.from('player-data'));

      const finished = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(finished.status).toBe('completed');

      const apk = harness.remote.files.get(fakeQuestApkPath) ?? Buffer.alloc(0);
      const installed = unzipSync(apk);
      expect(Buffer.from(installed['lib/arm64-v8a/libmain.so'] ?? []).toString()).toBe('libmain-loader-bytes');
      expect(installed['modded.json']).toBeDefined();
      expect(apk.includes('APK Sig Block 42')).toBe(true);
      expect(harness.remote.files.get(questScotland2Path)?.toString()).toBe('scotland2-bytes');

      expect(harness.remote.files.get(obbPath)?.toString()).toBe('song-data');
      expect(harness.remote.files.has(playerDataPath)).toBe(false);
      expect(harness.remote.files.get(keeperPath)?.toString()).toBe('player-data');
      expect(harness.remote.files.get('/sdcard/Encore/PlayerData.backup.dat')?.toString()).toBe('player-data');
      expect([...harness.remote.files.keys()].some((path) => path.startsWith('/data/local/tmp/'))).toBe(false);
   });

   test('keeps the backup when the reinstall fails and recovers it on retry', async () => {
      const harness = createHarness();
      const install = harness.remote.client.installApk;
      harness.remote.files.set(obbPath, Buffer.from('song-data'));
      harness.remote.files.set(playerDataPath, Buffer.from('player-data'));
      harness.remote.client.installApk = async () => Result.err<void, Problem>({ code: 'android.adb.install-failed', message: 'nope' });

      const failed = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(failed.status).toBe('failed');

      expect(harness.remote.files.get(`${backupDir}/obb/main.obb`)?.toString()).toBe('song-data');
      expect(harness.remote.files.get(`${backupDir}/PlayerData.dat`)?.toString()).toBe('player-data');
      expect(harness.remote.files.get(`${backupDir}/original.apk`)).toEqual(vanillaApk());

      harness.remote.client.installApk = install;
      const retry = createHarness({ gameVersion: null, remote: harness.remote });
      const finished = await retry.run(await retry.service.patchInstall({ targetId }));
      expect(finished.status).toBe('completed');
      expect(harness.remote.files.get(obbPath)?.toString()).toBe('song-data');
      expect(harness.remote.files.get(keeperPath)?.toString()).toBe('player-data');
   });

   test('recovers the original game and assets when downgrading fails after uninstall', async () => {
      const harness = createHarness({
         versionCatalog: { plan: async (installedVersion) => Result.ok({ installedVersion, version: '1.39.0', downgrade: true, diffSequence: [] }) },
         downgrade: {
            prepare: async () =>
               Result.ok({
                  run: async () => {
                     await harness.remote.client.uninstallPackage('Q1SERIAL', beatSaberPackageId);
                     return Result.err({ code: 'quest.downgrade.failed', message: 'the native install failed' });
                  }
               })
         }
      });
      harness.remote.files.set(obbPath, Buffer.from('newer-game-assets'));

      const finished = await harness.run(await harness.service.patchInstall({ targetId }));

      expect(finished.status).toBe('failed');
      expect(finished.error?.details).toMatchObject({ recovery: 'restored' });
      expect(harness.remote.files.get(fakeQuestApkPath)).toEqual(vanillaApk());
      expect(harness.remote.files.get(obbPath)?.toString()).toBe('newer-game-assets');
   });

   test('puts the save where the reinstalled game reads it when restoring datakeeper fails after install', async () => {
      const harness = createHarness();
      const push = harness.remote.client.push;
      harness.remote.files.set(obbPath, Buffer.from('song-data'));
      harness.remote.files.set(keeperPath, playerData([['Crab Rave', 800_000]]));
      harness.remote.files.set(playerDataPath, playerData([['Ghost', 950_000]]));
      harness.remote.client.push = async (serial, localPath, remotePath) => {
         if (!remotePath.startsWith(`${keeperPath}.`)) return push(serial, localPath, remotePath);
         harness.remote.files.set(remotePath, Buffer.from('truncated'));
         return Result.ok<void, Problem>(undefined);
      };

      const failed = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(failed.error?.details).toMatchObject({ recovery: 'restored' });
      expect(harness.remote.files.get(fakeQuestApkPath)).toEqual(vanillaApk());
      expect(harness.remote.files.get(obbPath)?.toString()).toBe('song-data');
      expect(harness.remote.files.get(keeperPath)).toEqual(playerData([['Crab Rave', 800_000]]));
      expect(harness.remote.files.has(`${backupDir}/PlayerData.dat`)).toBe(true);
      expect(JSON.parse(harness.remote.files.get(questSavedPlayerDataPath)?.toString() ?? '')).toMatchObject({
         localPlayers: [{ levelsStatsData: [{ levelId: 'Crab Rave' }, { levelId: 'Ghost', highScore: 950_000 }] }]
      });
   });

   test('keeps the backup until core mods install so a retry can finish the patch', async () => {
      let offline = true;
      const harness = createHarness({
         installCoreMods: async () =>
            offline
               ? Result.err({ code: 'quest.mods.install-failed', message: 'offline' })
               : Result.ok({ installId: 'beat-saber', mods: 0, files: 0, bytes: 0 })
      });
      harness.remote.files.set(playerDataPath, playerData([['Crab Rave', 950_000]]));

      expect((await harness.run(await harness.service.patchInstall({ targetId }))).status).toBe('failed');
      expect(harness.remote.files.get(`${backupDir}/original.apk`)).toEqual(vanillaApk());

      offline = false;
      expect((await harness.run(await harness.service.patchInstall({ targetId }))).status).toBe('completed');
      expect([...harness.remote.files.keys()].some((path) => path.startsWith(backupDir))).toBe(false);
   });

   test('folds a backup left by an earlier attempt into the live saves instead of blocking on its version', async () => {
      const harness = createHarness();
      harness.remote.dirs.add(`${backupDir}/done`);
      harness.remote.files.set(`${backupDir}/original.apk`, Buffer.from('older-apk'));
      harness.remote.files.set(`${backupDir}/version`, Buffer.from('1.39.0'));
      harness.remote.files.set(`${backupDir}/PlayerData.dat`, playerData([['Crab Rave', 990_000]]));
      harness.remote.files.set(
         playerDataPath,
         playerData([
            ['Crab Rave', 950_000],
            ['Ghost', 700_000]
         ])
      );

      const finished = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(finished.status).toBe('completed');
      expect(JSON.parse(harness.remote.files.get(keeperPath)?.toString() ?? '')).toMatchObject({
         localPlayers: [
            {
               levelsStatsData: [
                  { levelId: 'Crab Rave', highScore: 990_000 },
                  { levelId: 'Ghost', highScore: 700_000 }
               ]
            }
         ]
      });
   });

   test('keeps the old backup intact when building its replacement fails', async () => {
      const harness = createHarness();
      const copyPath = harness.remote.client.copyPath;
      harness.remote.dirs.add(`${backupDir}/done`);
      harness.remote.files.set(`${backupDir}/original.apk`, Buffer.from('older-apk'));
      harness.remote.files.set(`${backupDir}/PlayerData.dat`, playerData([['Crab Rave', 990_000]]));
      harness.remote.files.set(playerDataPath, playerData([['Ghost', 700_000]]));
      harness.remote.files.set(obbPath, Buffer.from('song-data'));
      harness.remote.client.copyPath = async (serial, from, to) =>
         to.endsWith('-next/obb') ? Result.err<void, Problem>({ code: 'android.adb.failed', message: 'disk full' }) : copyPath(serial, from, to);

      const failed = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(failed.status).toBe('failed');
      expect(harness.remote.files.get(`${backupDir}/PlayerData.dat`)).toEqual(playerData([['Crab Rave', 990_000]]));
   });

   test('drops its own backup when it fails before touching the game', async () => {
      const harness = createHarness({ apk: vanillaApk({ application: false }) });
      harness.remote.files.set(playerDataPath, Buffer.from('player-data'));

      const failed = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(failed.error?.code).toBe('quest.patch.manifest-invalid');
      expect(harness.remote.files.get(playerDataPath)?.toString()).toBe('player-data');
      expect([...harness.remote.files.keys()].some((path) => path.startsWith(backupDir))).toBe(false);
   });

   test('keeps a datakeeper save it cannot parse and still finishes patching', async () => {
      const harness = createHarness();
      harness.remote.files.set(keeperPath, Buffer.from('not json'));
      harness.remote.files.set(playerDataPath, playerData([['Crab Rave', 950_000]]));

      const finished = await harness.run(await harness.service.patchInstall({ targetId }));
      expect(finished.status).toBe('completed');
      expect(harness.remote.files.get(keeperPath)?.toString()).toBe('not json');
      expect(harness.remote.files.get('/sdcard/Encore/PlayerData.backup.dat')).toEqual(playerData([['Crab Rave', 950_000]]));
   });
});

function playerData(levels: [string, number][]) {
   const levelsStatsData = levels.map(([levelId, highScore]) => ({ levelId, difficulty: 4, beatmapCharacteristicName: 'Standard', highScore }));
   return Buffer.from(JSON.stringify({ localPlayers: [{ playerId: 'quest-user', levelsStatsData }] }));
}

function createHarness(
   input: {
      gameVersion?: string | null;
      versionCatalog?: QuestPatchServiceOptions['versionCatalog'];
      downgrade?: QuestPatchServiceOptions['downgrade'];
      remote?: ReturnType<typeof createFakeQuestFs>;
      apk?: Buffer;
      installCoreMods?: QuestPatchServiceOptions['installCoreMods'];
   } = {}
) {
   const remote = input.remote ?? createFakeQuestFs({ apk: input.apk ?? vanillaApk() });
   const operations = createOperationRegistry();
   const service = createQuestPatchService({
      devices: createFakeQuestDevices(remote.client, { gameVersion: input.gameVersion, modloaderInstalled: false }),
      operations,
      dataPath: join(dir, 'data'),
      appVersion: '1.2.3',
      resources: {
         libMainLoader: async () => Result.ok<string, Problem>(join(loaderDir, 'libmain.so')),
         scotland2: async () => Result.ok<string, Problem>(join(loaderDir, 'libsl2.so')),
         unstrippedUnity: async () => Result.ok(null),
         legacyOvrPlatformLoader: async () => Result.err<string, Problem>({ code: 'quest.patch.download-failed', message: 'Quest 1 only' })
      },
      versionCatalog: input.versionCatalog ?? {
         plan: async (installedVersion) => Result.ok({ installedVersion, version: installedVersion, downgrade: false, diffSequence: [] })
      },
      downgrade: input.downgrade,
      installCoreMods: input.installCoreMods ?? (async () => Result.ok({ installId: 'beat-saber', mods: 0, files: 0, bytes: 0 })),
      stagingRoot: dir,
      mutations: createQuestMutationLock()
   });

   return {
      service,
      remote,
      run: (started: Awaited<ReturnType<typeof service.patchInstall>>) => waitForOperation(operations, started.unwrap().id, { targetId })
   };
}

function vanillaApk({ application = true } = {}) {
   const applicationEvents: AxmlEvent[] = application
      ? [
           { kind: 'start-element', lineNumber: 2, namespace: null, name: 'application', attributes: [] },
           { kind: 'end-element', lineNumber: 2, namespace: null, name: 'application' }
        ]
      : [];
   const manifest = serializeAxml([
      { kind: 'start-namespace', prefix: 'android', uri: androidNamespaceUri },
      {
         kind: 'start-element',
         lineNumber: 1,
         namespace: null,
         name: 'manifest',
         attributes: [
            { namespace: androidNamespaceUri, name: 'versionName', resourceId: 0x0101021c, value: { type: 'string', value: '1.40.0' } },
            { namespace: null, name: 'package', resourceId: null, value: { type: 'string', value: beatSaberPackageId } }
         ]
      },
      ...applicationEvents,
      { kind: 'end-element', lineNumber: 3, namespace: null, name: 'manifest' },
      { kind: 'end-namespace', prefix: 'android', uri: androidNamespaceUri }
   ]);

   return Buffer.from(
      zipSync(
         {
            'AndroidManifest.xml': new Uint8Array(manifest),
            'classes.dex': new TextEncoder().encode('dex-bytes'),
            'lib/arm64-v8a/libmain.so': new TextEncoder().encode('stock-libmain')
         },
         { mtime: new Date('2024-01-01T00:00:00Z') }
      )
   );
}
