import { Result } from 'better-result';
import { afterEach, expect, test } from 'vite-plus/test';

import { getDownload, implementApi, implementTargetApi, type TargetSnapshot } from '@/lib/api';
import { createProblem } from '@/lib/errors';
import { createSecretStore } from '@/lib/security/secret-store';
import { mapsApi, mapSyncApi } from '@/modules/maps/api';
import { operationsApi } from '@/modules/operations/api';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitFor } from '@/modules/operations/main/operation-waiting.fixture';
import { questApi } from '@/modules/quest/api';
import { questInstallId, type QuestState } from '@/modules/quest/contract';
import { createReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverServer } from '@/modules/receiver/main/receiver-server';
import { createRemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { createRemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import { probeReceiverIdentity, requestReceiverJson } from '@/modules/receiver/main/remote-receiver-transport';
import { createRemoteTargetId } from '@/modules/receiver/main/remote/remote-session';
import {
   receiverPairCompleteResponseSchema,
   receiverPairStartResponseSchema,
   receiverProcedureEnvelopeSchema,
   receiverProcedurePath,
   receiverProtocolVersion,
   receiverProtocolVersionHeader
} from '@/modules/receiver/protocol';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import { localTargetId, type Target, type TargetEvent } from '@/modules/targets/contract';

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

type Harness = Awaited<ReturnType<typeof createHarness>>;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) await cleanup();
   cleanups.length = 0;
});

test('serves paired devices over RPC and SSE and drops them once revoked', async () => {
   const harness = await createHarness();
   const unauthenticated = await rawGet(harness.port, '/capabilities', { [receiverProtocolVersionHeader]: String(receiverProtocolVersion) });
   expect(unauthenticated.status).toBe(401);

   const paired = await pair(harness);
   const streamed: string[] = [];
   paired.client.subscribeSnapshots(operationsApi.namespace, (event) => streamed.push(operationsApi.snapshot.parse(event.snapshot).id));
   const operation = harness.operations.create({ kind: 'download', title: 'remote work' });

   expect(await paired.client.callTarget(paired.targetId, operationsApi.namespace, 'list', 'run-operations', {})).toMatchObject({
      status: 'ok',
      value: [{ id: operation.id }]
   });
   await waitFor(() => streamed.includes(operation.id), 'operation snapshot streamed');

   const device = (await harness.settingsStore.getSnapshot()).app.receiver.pairedDevices[0];
   if (!device) throw new Error('receiver device was not paired');
   expect((await harness.server.revokeDevice(device.id)).isOk()).toBe(true);

   expect(await paired.client.callTarget(paired.targetId, operationsApi.namespace, 'list', 'run-operations', {})).toMatchObject({
      status: 'unavailable'
   });
   expect(paired.client.listTargets().find((target) => target.id === paired.targetId)).toMatchObject({ status: 'unpaired', capabilities: [] });
   expect(await paired.client.callTarget(paired.targetId, operationsApi.namespace, 'list', 'run-operations', {})).toMatchObject({
      status: 'unsupported'
   });
});

test('fails closed when the pinned identity no longer matches', async () => {
   const harness = await createHarness();
   const paired = await pair(harness);
   paired.client.dispose();
   const record = (await harness.remoteStore.listRecords())[0];
   if (!record) throw new Error('remote receiver record was not stored');
   const other = await createHarness();

   await harness.remoteStore.saveRecord({ ...record, port: other.port });
   const pinned = createRemoteReceiverClient({ store: harness.remoteStore });
   cleanups.push(async () => pinned.dispose());
   await pinned.restore();

   await waitFor(
      () => pinned.listTargets().some((target) => target.id === paired.targetId && target.status === 'incompatible'),
      'pinned identity mismatch detected'
   );
});

test('relays only the targets attached to the receiver', async () => {
   const harness = await createHarness();
   const headset: Target = { id: 'quest:1WMHH', kind: 'quest', name: 'Quest 3', status: 'ready', capabilities: ['patch-game', 'manage-maps'] };
   harness.attach([headset]);
   const paired = await pair(harness);
   const relayedId = `${paired.targetId}/${headset.id}`;
   const snapshots: string[] = [];
   paired.client.subscribeSnapshots(questApi.namespace, (event) => snapshots.push(event.targetId));

   expect(paired.client.listTargets()).toContainEqual(expect.objectContaining({ id: relayedId, kind: 'quest', via: 'zhu' }));
   expect(await paired.client.callTarget(relayedId, questApi.namespace, 'getState', 'patch-game', {})).toMatchObject({
      status: 'ok',
      value: { modded: true }
   });
   expect(await paired.client.callTarget(paired.targetId, questApi.namespace, 'getState', 'patch-game', {})).toMatchObject({
      status: 'unsupported'
   });

   const archive = join(harness.dataPath, 'map.zip');
   const downloaded = await paired.client.downloadTarget(
      relayedId,
      mapsApi.namespace,
      'exportArchive',
      getDownload(mapsApi, 'exportArchive'),
      { installId: questInstallId, mapId: 'a1b2' },
      archive
   );
   expect(downloaded).toMatchObject({ status: 'ok', value: { sizeBytes: 'map a1b2 from quest:1WMHH'.length } });
   expect(await readFile(archive, 'utf8')).toBe('map a1b2 from quest:1WMHH');

   harness.emitQuestState({ targetId: headset.id, snapshot: { modded: false, savedPlayerData: true, companionInstalled: false } });
   await waitFor(() => snapshots.includes(relayedId), 'relayed snapshot streamed');

   const forged = await requestReceiverJson({
      endpoint: paired.endpoint,
      path: receiverProcedurePath(questApi.namespace, 'getState'),
      method: 'POST',
      token: paired.token,
      targetId: 'quest:emulator-5554',
      body: {},
      schema: receiverProcedureEnvelopeSchema
   });
   expect(Result.isError(forged) && forged.error.code).toBe('receiver.target.not-found');

   harness.attach([]);
   await waitFor(() => !paired.client.listTargets().some((target) => target.id === relayedId), 'relayed headset removed');
   expect(await paired.client.callTarget(relayedId, questApi.namespace, 'getState', 'patch-game', {})).toMatchObject({ status: 'unsupported' });
});

test('refuses requests naming a target this receiver only reaches through another receiver', async () => {
   const harness = await createHarness();
   harness.attach([{ id: 'quest:1WMHH', kind: 'quest', name: 'Quest 3', status: 'ready', capabilities: ['manage-maps'] }]);
   const paired = await pair(harness);
   const preview = (first: string, second: string) =>
      paired.client.callTarget(paired.targetId, mapSyncApi.namespace, 'preview', 'manage-maps', {
         first: { targetId: first, installId: 'a' },
         second: { targetId: second, installId: questInstallId }
      });

   expect(await preview(localTargetId, 'quest:1WMHH')).toMatchObject({ status: 'ok' });
   expect(await preview(localTargetId, 'remote_0123456789ab/quest:1WMHH')).toMatchObject({
      status: 'unavailable',
      error: { code: 'receiver.target.not-found' }
   });
   expect(harness.mapSyncPreviews).toEqual([localTargetId]);
});

test('a response arriving after forget leaves the receiver removed', async () => {
   const harness = await createHarness();
   const paired = await pair(harness);
   const request = paired.client.callTarget(paired.targetId, operationsApi.namespace, 'list', 'run-operations', {});
   const events: TargetEvent[] = [];
   paired.client.subscribe((event) => events.push(event));
   expect((await paired.client.forget(paired.targetId)).isOk()).toBe(true);
   await request;

   expect(events).toEqual([{ type: 'target-removed', targetId: paired.targetId }]);
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-bridge-'));
   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   await settingsStore.updateAppSettingsWith(() => ({ receiver: { interfaceName: 'lo0' } }));
   const secretStore = createSecretStore({
      dataPath,
      platform: 'darwin',
      protection: {
         isEncryptionAvailable: () => true,
         getSelectedStorageBackend: () => 'keychain',
         encryptString: (plainText) => Buffer.from(plainText),
         decryptString: (encrypted) => encrypted.toString()
      }
   });
   const operations = createOperationRegistry();
   let attached: Target[] = [];
   const mapSyncPreviews: string[] = [];
   const targetListeners = new Set<(event: TargetEvent) => void>();
   const questListeners = new Set<(event: TargetSnapshot<QuestState>) => void>();
   const server = createReceiverServer({
      settingsStore,
      identityStore: createReceiverIdentityStore({ secretStore }),
      implementations: [
         implementApi(operationsApi, operations, { subscribe: operations.subscribe }),
         implementApi(mapSyncApi, {
            preview: async ({ first }) => {
               mapSyncPreviews.push(first.targetId);
               return { toFirst: 0, toSecond: 0, problem: null, runsOn: null };
            },
            start: () => Result.err(createProblem('maps.sync.unsupported'))
         })
      ],
      attached: {
         listTargets: () => attached,
         subscribe: (listener) => subscribeTo(targetListeners, listener),
         implementations: [
            implementTargetApi(
               questApi,
               {
                  getState: ({ targetId }) => ({
                     modded: attached.some((target) => target.id === targetId),
                     savedPlayerData: false,
                     companionInstalled: false
                  })
               },
               { subscribe: (listener) => subscribeTo(questListeners, listener) }
            ),
            implementTargetApi(
               mapsApi,
               {},
               {
                  downloads: {
                     exportArchive: async ({ targetId, mapId }) => Result.ok(Readable.from([Buffer.from(`map ${mapId} from ${targetId}`)]))
                  }
               }
            )
         ]
      },
      getSecretStoreAvailability: () => secretStore.getAvailability(),
      name: 'zhu',
      port: 0,
      listAddresses: () => [{ host: '127.0.0.1', interfaceName: 'lo0' }]
   });
   expect((await server.start()).isOk()).toBe(true);
   const port = server.getState().addresses[0]?.port ?? 0;

   cleanups.push(async () => {
      await server.stop();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      settingsStore,
      operations,
      mapSyncPreviews,
      server,
      port,
      remoteStore: createRemoteTargetStore({ settingsStore, secretStore }),
      attach: (targets: Target[]) => {
         const removed = attached.filter((target) => !targets.includes(target));
         attached = targets;
         for (const listener of targetListeners) {
            for (const target of targets) listener({ type: 'target-updated', target });
            for (const target of removed) listener({ type: 'target-removed', targetId: target.id });
         }
      },
      emitQuestState: (event: TargetSnapshot<QuestState>) => {
         for (const listener of questListeners) listener(event);
      }
   };
}

function subscribeTo<Listener>(listeners: Set<Listener>, listener: Listener) {
   listeners.add(listener);
   return () => {
      listeners.delete(listener);
   };
}

async function pair(harness: Harness) {
   const session = harness.server.startPairing();
   if (Result.isError(session)) throw new Error('pairing did not start');

   const identity = await probeReceiverIdentity({ host: '127.0.0.1', port: harness.port });
   if (Result.isError(identity)) throw new Error(identity.error.message);
   const endpoint = { host: '127.0.0.1', port: harness.port, certificatePem: identity.value.certificatePem, fingerprint: identity.value.fingerprint };

   const started = await requestReceiverJson({
      endpoint,
      path: '/pair/start',
      method: 'POST',
      body: { deviceName: 'controller' },
      schema: receiverPairStartResponseSchema
   });
   if (Result.isError(started)) throw new Error(started.error.message);
   const completed = await requestReceiverJson({
      endpoint,
      path: '/pair/complete',
      method: 'POST',
      body: { code: session.value.code, deviceName: 'controller' },
      schema: receiverPairCompleteResponseSchema
   });
   if (Result.isError(completed)) throw new Error(completed.error.message);

   const targetId = createRemoteTargetId(endpoint);
   await harness.remoteStore.saveRecord({ id: targetId, name: identity.value.name, ...endpoint, pairedAt: new Date().toISOString() });
   await harness.remoteStore.saveToken(targetId, completed.value.token);

   const client = createRemoteReceiverClient({ store: harness.remoteStore });
   cleanups.push(async () => client.dispose());
   let streaming = false;
   client.subscribe((event) => {
      if (event.type === 'target-updated' && event.target.id === targetId && event.target.status === 'ready') streaming = true;
   });
   await client.restore();
   await waitFor(() => streaming, 'receiver stream attached');

   return { client, targetId, endpoint, token: completed.value.token };
}

function rawGet(port: number, path: string, headers: Record<string, string>) {
   return new Promise<{ status: number }>((resolve, reject) => {
      const clientRequest = httpsRequest({ host: '127.0.0.1', port, path, agent: false, rejectUnauthorized: false, headers }, (response) => {
         response.resume();
         response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
      });
      clientRequest.on('error', reject);
      clientRequest.end();
   });
}
