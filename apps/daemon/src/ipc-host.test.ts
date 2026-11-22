import { Result } from 'better-result';
import { afterEach, expect, test } from 'vite-plus/test';

import { createQuestDaemon } from './daemon';
import { createEncoreIpcHost } from './ipc-host';
import { createMobileCore } from './mobile-core';
import { createDaemonSecretProtection } from './secret-protection';

import { createEncoreApi } from '@/ipc/api';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createSecretStore } from '@/lib/security/secret-store';
import { buildModIndex } from '@/modules/mods/main/mod-index';
import { questInstallId } from '@/modules/quest/contract';
import { createFakeQuestDevices, createFakeQuestFs } from '@/modules/quest/main/quest-fs.fixture';
import { createQuestModService } from '@/modules/quest/main/quest-mod-service';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { createQuestPatchService } from '@/modules/quest/main/quest-patch-service';
import { createQuestTarget } from '@/modules/quest/main/quest-target';
import type { Target } from '@/modules/targets/contract';

import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const targetId = 'quest:Q1SERIAL';
let cleanup = async () => {};

afterEach(() => cleanup());

test('routes generated Quest procedures and events by target and rejects malformed requests', async () => {
   const { host, daemon } = await createHarness();
   const api = createEncoreApi('android', host.invoke, host.subscribe, 'mobile');
   expect((await api.targets.list()).map((target) => target.id)).toEqual([targetId]);

   const events: string[] = [];
   const unsubscribe = api.operations.onSnapshot((event) => events.push(`${event.targetId}:${event.snapshot.id}`));
   const operation = daemon.operations.create({ targetId, kind: 'patch', title: 'Patch Beat Saber' });
   const listed = await api.operations.list({ targetId });
   expect(listed.status === 'ok' && listed.value.map((entry) => entry.id)).toEqual([operation.id]);
   expect(events).toEqual([`${targetId}:${operation.id}`]);
   unsubscribe();

   await expect(host.invoke('mods:prepareImportUpload', { targetId, installId: questInstallId })).rejects.toMatchObject({
      code: 'ipc.invalid-request'
   });
   await expect(host.invoke('operations:list', { targetId }, { targetId })).rejects.toMatchObject({ code: 'ipc.invalid-request' });
   await expect(host.invoke('operations:snapshot')).rejects.toMatchObject({ code: 'ipc.invalid-request' });

   host.dispose();
   await expect(host.invoke('targets:list')).rejects.toMatchObject({ code: 'mobile.request-failed' });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-mobile-ipc-'));
   const core = createMobileCore({
      dataPath,
      appVersion: '0.1.15',
      platform: 'android',
      secretStore: createSecretStore({ dataPath, platform: 'android', protection: createDaemonSecretProtection(randomBytes(32), 'android_keystore') })
   });
   const base = createQuestDaemon(core);
   const target: Target = {
      id: targetId,
      kind: 'quest',
      name: 'Quest 3',
      status: 'ready',
      capabilities: ['list-installs', 'manage-mods', 'run-operations']
   };
   const devices = {
      ...createFakeQuestDevices(createFakeQuestFs().client),
      listTargets: () => [target]
   };
   const index = buildModIndex({
      gameVersion: '1.40.0',
      platform: 'quest',
      source: 'cache',
      updatedAt: new Date().toISOString(),
      sources: [],
      entries: []
   });
   const mutations = createQuestMutationLock();
   const mods = createQuestModService({
      devices,
      operations: base.operations,
      repositories: core.repositories,
      catalog: { get: async () => Result.ok(index), refresh: async () => Result.ok(index) },
      stagingRoot: dataPath,
      mutations
   });
   const questTarget = createQuestTarget({
      dataPath,
      ingestion: createContentIngestionService({ dataPath }),
      devices,
      operations: base.operations,
      mutations,
      mods,
      patching: createQuestPatchService({
         devices,
         operations: base.operations,
         dataPath,
         appVersion: '0.1.15',
         stagingRoot: dataPath,
         installCoreMods: mods.installCoreMods,
         mutations
      })
   });
   const daemon = { ...base, devices, questTarget };
   const host = createEncoreIpcHost({
      core,
      quest: daemon,
      platform: 'android',
      native: {
         chooseFile: async () => Result.ok({ status: 'cancelled' }),
         copyText: async () => Result.ok(undefined),
         openLink: async () => Result.ok({ status: 'opened' })
      }
   });
   cleanup = async () => {
      host.dispose();
      await daemon.stop();
      await rm(dataPath, { recursive: true, force: true });
   };
   await host.ready;
   return { host, daemon };
}
