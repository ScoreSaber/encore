import { Result } from 'better-result';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';

import type { Problem } from '@/lib/errors';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitFor, waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import type { QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createFakeQuestDevices, createFakeQuestFs, fakeQuestApkPath } from '@/modules/quest/main/quest-fs.fixture';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import {
   questBackup,
   questDataKeeperPlayerDataPath,
   questMergedPlayerDataPath,
   questPlayerDataPath,
   questSavedPlayerDataPath
} from '@/modules/quest/main/quest-paths';
import { createQuestUnmodService } from '@/modules/quest/main/quest-unmod-service';
import type { TargetEvent } from '@/modules/targets/contract';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const targetId = 'quest:Q1SERIAL';
const playerData = (highScore: number, playerHeight: number) =>
   Buffer.from(
      JSON.stringify({
         version: '2.0.28',
         localPlayers: [
            {
               playerId: 'quest-user',
               playerSpecificSettings: { playerHeight },
               levelsStatsData: [{ levelId: 'Crab Rave', difficulty: 4, beatmapCharacteristicName: 'Standard', highScore, fullCombo: false }]
            }
         ]
      })
   );

let dir: string;

beforeAll(async () => {
   dir = await mkdtemp(join(tmpdir(), 'encore-quest-unmod-test-'));
});

afterAll(async () => {
   await rm(dir, { recursive: true, force: true });
});

describe('quest unmodding', () => {
   test('saves the modded player data, uninstalls the game and merges it into the store reinstall once that has a save', async () => {
      const remote = createFakeQuestFs({ apk: Buffer.from('patched-apk') });
      remote.files.set(questDataKeeperPlayerDataPath, playerData(900_000, 1.8));
      const operations = createOperationRegistry();
      let emit = (_event: TargetEvent) => {};
      const devices = (modloaderInstalled: boolean): QuestDeviceService => ({
         ...createFakeQuestDevices(remote.client, { gameVersion: '1.40.8_7379', modloaderInstalled }),
         getState: () => ({ modded: modloaderInstalled, savedPlayerData: remote.files.has(questSavedPlayerDataPath), companionInstalled: false }),
         subscribe: (listener) => {
            emit = listener;
            return () => {};
         }
      });
      const service = (modloaderInstalled: boolean) =>
         createQuestUnmodService({ devices: devices(modloaderInstalled), operations, mutations: createQuestMutationLock(), stagingRoot: dir });
      const updated = () =>
         emit({ type: 'target-updated', target: { id: targetId, kind: 'quest', name: 'Quest 3', status: 'ready', capabilities: [] } });
      const merge = () => operations.listForTarget(targetId).find((operation) => operation.kind === 'copy');

      const started = service(true).unmod({ targetId }).unwrap();
      expect((await waitForOperation(operations, started.id, { targetId })).status).toBe('completed');
      expect(remote.files.has(fakeQuestApkPath)).toBe(false);
      expect(remote.files.get(questSavedPlayerDataPath)).toEqual(playerData(900_000, 1.8));

      remote.files.set(fakeQuestApkPath, Buffer.from('store-apk'));
      service(false);
      updated();
      await setTimeout(20);
      expect(merge()).toBeUndefined();

      remote.files.set(questPlayerDataPath, playerData(950_000, 1.7));
      updated();
      await waitFor(() => merge()?.completedAt !== undefined, 'the player data merge');
      expect(merge()?.status).toBe('completed');
      expect(JSON.parse(remote.files.get(questPlayerDataPath)?.toString() ?? '')).toMatchObject({
         localPlayers: [{ playerSpecificSettings: { playerHeight: 1.8 }, levelsStatsData: [{ highScore: 950_000 }] }]
      });
      expect(remote.files.has(questSavedPlayerDataPath)).toBe(false);
      expect(remote.files.has(questMergedPlayerDataPath)).toBe(true);
   });

   test('keeps a failed patch backup until its save is published with the rest', async () => {
      const remote = createFakeQuestFs({ apk: Buffer.from('patched-apk') });
      remote.files.set(questBackup.playerData, playerData(990_000, 1.7));
      remote.files.set(questPlayerDataPath, playerData(900_000, 1.8));
      const operations = createOperationRegistry();
      const service = createQuestUnmodService({
         devices: createFakeQuestDevices(remote.client, { gameVersion: '1.40.8_7379', modloaderInstalled: true }),
         operations,
         mutations: createQuestMutationLock(),
         stagingRoot: dir
      });
      const unmod = async () => (await waitForOperation(operations, service.unmod({ targetId }).unwrap().id, { targetId })).status;
      const sha1Files = remote.client.sha1Files;
      remote.client.sha1Files = async () => Result.err<string, Problem>({ code: 'android.adb.hash-failed', message: 'nope' });

      expect(await unmod()).toBe('failed');
      expect(remote.files.get(questBackup.playerData)).toEqual(playerData(990_000, 1.7));
      expect(remote.files.has(fakeQuestApkPath)).toBe(true);

      remote.client.sha1Files = sha1Files;
      expect(await unmod()).toBe('completed');
      expect(remote.files.has(questBackup.playerData)).toBe(false);
      expect(JSON.parse(remote.files.get(questSavedPlayerDataPath)?.toString() ?? '')).toMatchObject({
         localPlayers: [{ playerSpecificSettings: { playerHeight: 1.8 }, levelsStatsData: [{ highScore: 990_000 }] }]
      });
   });
});
