import { Result } from 'better-result';

import type { MobileCore } from './mobile-core';

import { createAndroidAdb } from '@/lib/android/android-adb';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import type { QuestLocalPairing, QuestWirelessSettingsPage } from '@/modules/quest/contract';
import { createQuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestModService } from '@/modules/quest/main/quest-mod-service';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { createQuestPatchService } from '@/modules/quest/main/quest-patch-service';
import { createQuestTarget } from '@/modules/quest/main/quest-target';
import { createReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverServer } from '@/modules/receiver/main/receiver-server';

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type QuestDaemon = ReturnType<typeof createQuestDaemon>;

type QuestAdb = Omit<Parameters<typeof createAndroidAdb>[0], 'keyPath'> & {
   openWirelessDebuggingSettings?: () => Promise<Result<QuestWirelessSettingsPage, Problem>>;
};

export function createQuestDaemon(core: MobileCore, adb: QuestAdb = {}) {
   const { dataPath, appVersion, settingsStore, repositories } = core;
   const stagingRoot = join(dataPath, 'staging');
   const directAdb = createAndroidAdb({ ...adb, keyPath: join(dataPath, 'quest', 'adb-key.der') });
   const operations = createOperationRegistry();
   const mutations = createQuestMutationLock();
   const devices = createQuestDeviceService({
      provisioner: { resolve: async () => Result.ok('android') },
      createClient: () => directAdb.client,
      mutations
   });
   const mods = createQuestModService({ devices, operations, stagingRoot, repositories, mutations });
   const patching = createQuestPatchService({
      devices,
      operations,
      dataPath,
      appVersion,
      stagingRoot,
      installCoreMods: mods.installCoreMods,
      mutations
   });
   const questTarget = createQuestTarget({
      dataPath,
      ingestion: createContentIngestionService({ dataPath }),
      devices,
      mods,
      operations,
      patching,
      mutations
   });
   const name = translate('quest.receiverName');
   const receiver = createReceiverServer({
      settingsStore,
      identityStore: createReceiverIdentityStore({ secretStore: core.secretStore }),
      implementations: [],
      attached: questTarget,
      getSecretStoreAvailability: core.secretStore.getAvailability,
      name,
      getTarget: () => ({
         id: 'receiver-local',
         kind: 'remote',
         name,
         status: 'ready',
         capabilities: [],
         message: devices.listTargets().length > 0 ? undefined : translate('quest.standaloneDisconnected')
      })
   });
   type DaemonLifecycle =
      | { status: 'idle' }
      | { status: 'starting'; promise: Promise<void> }
      | { status: 'running' }
      | { status: 'failed' }
      | { status: 'stopping'; promise: Promise<void> }
      | { status: 'stopped' };
   let lifecycle: DaemonLifecycle = { status: 'idle' };
   let unsubscribeSettings: (() => void) | null = null;

   async function start() {
      if (lifecycle.status === 'running' || lifecycle.status === 'stopped') return;
      if (lifecycle.status === 'starting') return lifecycle.promise;
      if (lifecycle.status === 'stopping') {
         await lifecycle.promise;
         return;
      }

      const promise = (async () => {
         await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
         unsubscribeSettings ??= settingsStore.subscribe((snapshot) => void receiver.reconcile(snapshot));
         devices.start();
         await receiver.reconcile();
      })();
      lifecycle = { status: 'starting', promise };
      const started = await Result.tryPromise({ try: () => promise, catch: (cause) => cause });
      if (Result.isError(started)) {
         if (lifecycle.status === 'starting' && lifecycle.promise === promise) lifecycle = { status: 'failed' };
         throw started.error;
      }
      if (lifecycle.status === 'starting' && lifecycle.promise === promise) lifecycle = { status: 'running' };
   }

   async function stop() {
      if (lifecycle.status === 'stopped') return;
      if (lifecycle.status === 'stopping') return lifecycle.promise;
      const starting = lifecycle.status === 'starting' ? lifecycle.promise : null;
      const promise = (async () => {
         if (starting) await Result.tryPromise({ try: () => starting, catch: () => undefined });
         unsubscribeSettings?.();
         unsubscribeSettings = null;
         questTarget.dispose();
         mods.dispose();
         devices.dispose();
         await operations.dispose();
         await receiver.stop();
         await directAdb.dispose();
      })();
      lifecycle = { status: 'stopping', promise };
      try {
         await promise;
      } finally {
         if (lifecycle.status === 'stopping' && lifecycle.promise === promise) lifecycle = { status: 'stopped' };
      }
   }

   async function pairLocal({ code }: QuestLocalPairing) {
      const paired = await directAdb.pairLocal(code);
      if (Result.isError(paired)) return Result.err(paired.error);
      await devices.refresh();
      return Result.ok(null);
   }

   async function openLocalWirelessSettings() {
      const open = adb.openWirelessDebuggingSettings;
      return open ? open() : Result.err(createProblem('mobile.native-unavailable'));
   }

   return { operations, devices, questTarget, receiver, start, stop, pairLocal, openLocalWirelessSettings };
}
