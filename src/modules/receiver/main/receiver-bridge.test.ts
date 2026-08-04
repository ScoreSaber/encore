import { Result } from 'better-result';

import { defineApiHandlers } from '@/lib/api';
import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { buildZipArchive } from '@/lib/content/zip-archive.fixture';
import { createSecretStore, type SecretProtection } from '@/lib/security/secret-store';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { modsApi } from '@/modules/mods/api';
import type { ModUninstallRequest } from '@/modules/mods/contract';
import { beatModsDownloadUrl, createBeatModsApi } from '@/modules/mods/main/beatmods-api';
import { createModCatalogService } from '@/modules/mods/main/mod-catalog';
import { createModService } from '@/modules/mods/main/mod-service';
import { createModUploadService } from '@/modules/mods/main/mod-upload';
import { createModRepositoryService } from '@/modules/mods/main/repo-service';
import { operationsApi } from '@/modules/operations/api';
import type { OperationSnapshot } from '@/modules/operations/contract';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitFor } from '@/modules/operations/main/operation-waiting.fixture';
import { createReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverServer } from '@/modules/receiver/main/receiver-server';
import { createRemoteReceiverClient, type RemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { createRemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import { probeReceiverIdentity, requestReceiverJson, type ReceiverEndpoint } from '@/modules/receiver/main/remote-receiver-transport';
import { createRemoteTargetId } from '@/modules/receiver/main/remote/remote-session';
import {
   receiverPairCompleteResponseSchema,
   receiverPairStartResponseSchema,
   receiverProtocolVersion,
   receiverProtocolVersionHeader
} from '@/modules/receiver/protocol';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import { createTargetRegistry } from '@/modules/targets/main/target-registry';

import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Harness = Awaited<ReturnType<typeof createHarness>>;

const cleanups: (() => Promise<void>)[] = [];

setDefaultTimeout(20_000);

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('receiver bridge', () => {
   test('keeps discovery public and gates protected routes by protocol and auth', async () => {
      const harness = await createHarness();

      const discovery = await rawGet(harness.port, '/health', {});
      const missingProtocol = await rawGet(harness.port, '/capabilities', {});
      const unsupportedProtocol = await rawGet(harness.port, '/capabilities', {
         [receiverProtocolVersionHeader]: '1'
      });
      const missingToken = await rawGet(harness.port, '/capabilities', {
         [receiverProtocolVersionHeader]: String(receiverProtocolVersion)
      });

      expect(discovery.status).toBe(200);
      expect(JSON.parse(discovery.body)).toMatchObject({
         status: 'ready',
         supportedProtocolVersions: [receiverProtocolVersion]
      });
      expect([missingProtocol.status, unsupportedProtocol.status]).toEqual([426, 426]);
      expect(JSON.parse(unsupportedProtocol.body)).toMatchObject({
         error: { code: 'receiver.protocol.unsupported' }
      });
      expect(missingToken.status).toBe(401);
      expect(JSON.parse(missingToken.body)).toMatchObject({
         error: { code: 'receiver.auth.required' }
      });
   });

   test('installs and uninstalls mods on the paired receiver and streams the progress back', async () => {
      const harness = await createHarness();
      const paired = await pair(harness);
      const registry = createRegistry(paired.client);
      const install = await createModdableInstall(harness);
      const request = {
         targetId: paired.targetId,
         installId: install.installId,
         modIds: ['beatmods:2']
      };
      const progress: string[] = [];
      paired.client.subscribeSnapshots(operationsApi, (event) => {
         if (event.snapshot.progress) progress.push(event.snapshot.id);
      });

      const preview = await registry.callTarget(harness.modApi, 'previewInstall', paired.targetId, {
         installId: request.installId,
         modIds: request.modIds
      });
      expect(preview).toMatchObject({
         status: 'ok',
         value: { status: 'ok', downloadHosts: ['beatmods.com'] }
      });

      const startedCall = await registry.callTarget(harness.modApi, 'installMods', paired.targetId, {
         installId: request.installId,
         modIds: request.modIds
      });
      expect(startedCall.status).toBe('ok');
      if (startedCall.status !== 'ok') return;
      const started = startedCall.value;
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForRemoteOperation(paired.client, started.value.id)).toMatchObject({ status: 'completed' });
      expect(await readdir(join(install.installPath, 'IPA', 'Pending', 'Plugins'))).toEqual(['BSML.dll']);
      expect(progress).toContain(started.value.id);

      const removal: ModUninstallRequest = { ...request, scope: 'selection' };
      const removalPreview = await registry.callTarget(harness.modApi, 'previewUninstall', paired.targetId, {
         installId: removal.installId,
         modIds: removal.modIds,
         scope: removal.scope
      });
      expect(removalPreview).toMatchObject({
         status: 'ok',
         value: { status: 'ok', fileCount: 1 }
      });

      const removedCall = await registry.callTarget(harness.modApi, 'uninstallMods', paired.targetId, {
         installId: removal.installId,
         modIds: removal.modIds,
         scope: removal.scope
      });
      expect(removedCall.status).toBe('ok');
      if (removedCall.status !== 'ok') return;
      const removed = removedCall.value;
      expect(removed.ok).toBe(true);
      if (!removed.ok) return;

      expect(await waitForRemoteOperation(paired.client, removed.value.id)).toMatchObject({ status: 'completed' });
      expect(await readdir(join(install.installPath, 'IPA', 'Pending', 'Plugins'))).toEqual([]);
   });

   test('uploads and imports a local mod file on the paired receiver', async () => {
      const harness = await createHarness();
      const paired = await pair(harness);
      const registry = createRegistry(paired.client);
      const install = await createModdableInstall(harness);
      const sourcePath = join(harness.dataPath, 'Manual.dll');
      const bytes = Buffer.from('manual mod');
      await writeFile(sourcePath, bytes);

      const prepared = await registry.callTarget(harness.modApi, 'prepareImportUpload', paired.targetId, {
         installId: install.installId,
         fileName: 'Manual.dll',
         sizeBytes: bytes.byteLength,
         sha256: createHash('sha256').update(bytes).digest('hex')
      });
      expect(prepared).toMatchObject({ status: 'ok', value: { status: 'ready' } });
      if (prepared.status !== 'ok' || prepared.value.status !== 'ready') return;

      const uploadId = prepared.value.uploadId;
      const uploaded = await registry.uploadTarget(
         harness.modApi,
         'importFile',
         paired.targetId,
         { installId: install.installId, uploadId },
         { path: sourcePath, sizeBytes: bytes.byteLength }
      );
      expect(uploaded.status).toBe('ok');

      const preview = await registry.callTarget(harness.modApi, 'previewImportUpload', paired.targetId, {
         installId: install.installId,
         uploadId
      });
      expect(preview).toMatchObject({ status: 'ok', value: { status: 'ok', name: 'Manual.dll', uploadId } });

      const imported = await registry.callTarget(harness.modApi, 'importUpload', paired.targetId, {
         installId: install.installId,
         uploadId
      });
      expect(imported).toMatchObject({ status: 'ok', value: { ok: true } });
      if (imported.status !== 'ok' || !imported.value.ok) return;

      expect(await waitForRemoteOperation(paired.client, imported.value.value.id)).toMatchObject({ status: 'completed' });
      expect(await readdir(join(install.installPath, 'IPA', 'Pending', 'Plugins'))).toEqual(['Manual.dll']);
   });

   test('surfaces auth loss once the receiver revokes the device', async () => {
      const harness = await createHarness();
      const paired = await pair(harness);
      const device = (await harness.settingsStore.getSnapshot()).app.receiver.pairedDevices[0]!;

      const revoked = await harness.server.revokeDevice(device.id);
      const health = await paired.client.getHealth(paired.targetId);

      expect(revoked.ok).toBe(true);
      expect(health).toMatchObject({ status: 'unpaired', capabilities: [] });
      expect(await paired.client.callTarget(paired.targetId, operationsApi.namespace, 'list', operationsApi.procedures.list, {})).toMatchObject({
         status: 'unsupported'
      });
   });

   test('fails closed when the pinned identity no longer matches', async () => {
      const harness = await createHarness();
      const paired = await pair(harness);
      paired.client.dispose();

      const record = (await harness.remoteStore.listRecords())[0]!;
      const other = await createHarness();
      const otherIdentity = await probeReceiverIdentity({
         host: '127.0.0.1',
         port: other.port
      });
      expect(Result.isOk(otherIdentity)).toBe(true);
      if (Result.isError(otherIdentity)) return;

      await harness.remoteStore.saveRecord({ ...record, port: other.port });
      const pinned = createRemoteReceiverClient({
         store: harness.remoteStore,
         apis: harness.apiModules.map(({ api }) => api)
      });
      cleanups.push(async () => pinned.dispose());
      await pinned.restore();
      const health = await pinned.getHealth(paired.targetId);

      expect(otherIdentity.value.fingerprint).not.toBe(record.fingerprint);
      expect(health?.status).toBe('incompatible');
   });
});

async function createHarness() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-bridge-'));
   const settingsStore = createSettingsStore({
      dataPath,
      appVersion: '0.0.0',
      platform: 'linux',
      arch: 'x64'
   });
   const secretStore = createSecretStore({
      dataPath,
      platform: 'darwin',
      protection: createTestProtection(true)
   });
   const stores = { settingsStore, secretStore };
   const installs = createInstallRegistry({
      dataPath,
      settingsStore,
      detectStores: () => Promise.resolve({ candidates: [] })
   });
   const operations = createOperationRegistry();
   const operationApi = defineApiHandlers(operationsApi, operations, { subscribe: operations.subscribe });
   const modRepositories = createModRepositoryService({ dataPath, settingsStore });
   const mods = createModService({
      registry: installs,
      operations,
      dataPath,
      ingestion: createContentIngestionService({
         dataPath,
         fetchContent: fakeModCdn
      }),
      catalog: createModCatalogService({
         dataPath,
         repositories: modRepositories,
         api: createBeatModsApi({ fetchJson: fakeBeatMods })
      })
   });
   const modUploads = createModUploadService({ dataPath, mods });
   const modApi = defineApiHandlers(
      modsApi,
      {
         ...mods,
         syncRepositories: modRepositories.sync,
         prepareImportUpload: modUploads.prepare,
         previewImportUpload: modUploads.preview,
         importUpload: modUploads.importMod,
         discardImportUpload: async ({ uploadId }) => ({ discarded: await modUploads.discard(uploadId) })
      },
      { uploadHandlers: { importFile: modUploads.receive } }
   );
   const apiModules = [operationApi, modApi];
   const server = createReceiverServer({
      settingsStore,
      identityStore: createReceiverIdentityStore({ secretStore }),
      apiModules,
      getSecretStoreAvailability: () => secretStore.getAvailability(),
      platform: 'linux',
      port: 0,
      listAddresses: () => [{ host: '127.0.0.1', interfaceName: 'lo0' }],
      heartbeatIntervalMs: 1_000
   });

   const started = await server.start();
   expect(started.ok).toBe(true);
   const port = server.getState().addresses[0]?.port ?? 0;
   expect(port).toBeGreaterThan(0);

   cleanups.push(async () => {
      installs.dispose();
      await server.stop();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      settingsStore,
      installs,
      modApi,
      apiModules,
      server,
      port,
      remoteStore: createRemoteTargetStore(stores)
   };
}

async function pair(harness: Harness) {
   const session = harness.server.startPairing();
   expect(session.ok).toBe(true);
   if (!session.ok) throw new Error('pairing did not start');

   const identity = await probeReceiverIdentity({
      host: '127.0.0.1',
      port: harness.port
   });
   if (Result.isError(identity)) throw new Error(identity.error.message);

   const endpoint: ReceiverEndpoint = {
      host: '127.0.0.1',
      port: harness.port,
      certificatePem: identity.value.certificatePem,
      fingerprint: identity.value.fingerprint
   };

   const started = await requestReceiverJson({
      endpoint,
      path: '/pair/start',
      method: 'POST',
      body: { deviceName: 'controller' },
      schema: receiverPairStartResponseSchema
   });
   if (Result.isError(started)) throw new Error(started.error.message);
   expect(started.value.pairing.status).toBe('waiting');

   const completed = await requestReceiverJson({
      endpoint,
      path: '/pair/complete',
      method: 'POST',
      body: { code: session.value.code, deviceName: 'controller' },
      schema: receiverPairCompleteResponseSchema
   });
   if (Result.isError(completed)) throw new Error(completed.error.message);

   const targetId = createRemoteTargetId(endpoint);
   await harness.remoteStore.saveRecord({
      id: targetId,
      name: identity.value.name,
      host: endpoint.host,
      port: endpoint.port,
      fingerprint: endpoint.fingerprint,
      certificatePem: endpoint.certificatePem,
      pairedAt: new Date().toISOString()
   });
   await harness.remoteStore.saveToken(targetId, completed.value.token);

   const client = createRemoteReceiverClient({
      store: harness.remoteStore,
      apis: harness.apiModules.map(({ api }) => api)
   });
   cleanups.push(async () => client.dispose());
   let streaming = false;
   client.subscribe((event) => {
      if (event.type === 'target-updated' && event.target.id === targetId && event.target.status === 'ready') streaming = true;
   });
   await client.restore();
   await waitFor(() => streaming, 'receiver stream attached');

   return { client, endpoint, targetId, token: completed.value.token };
}

function createRegistry(client: RemoteReceiverClient) {
   return createTargetRegistry({ remote: client });
}

async function createModdableInstall(harness: Harness) {
   const installRoot = (await harness.settingsStore.getSnapshot()).library.installRoot;
   const installPath = join(installRoot, 'Beat Saber');
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');

   const registered = await harness.installs.register({
      source: 'library',
      path: installPath
   });
   if (Result.isError(registered)) throw new Error('the receiver install did not register');

   return { installPath, installId: registered.value.id };
}

async function waitForRemoteOperation(client: RemoteReceiverClient, operationId: string) {
   let snapshot: OperationSnapshot | undefined;
   const unsubscribe = client.subscribeSnapshots(operationsApi, (event) => {
      if (event.snapshot.id === operationId) snapshot = event.snapshot;
   });
   await waitFor(() => {
      return Boolean(snapshot?.completedAt);
   }, 'remote operation finished');
   unsubscribe();

   return snapshot;
}

function rawGet(port: number, path: string, headers: Record<string, string>) {
   return rawRequest('GET', port, path, headers);
}

function rawRequest(method: 'GET' | 'POST', port: number, path: string, headers: Record<string, string>) {
   return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const clientRequest = httpsRequest(
         {
            host: '127.0.0.1',
            port,
            path,
            method,
            agent: false,
            rejectUnauthorized: false,
            headers
         },
         (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () =>
               resolve({
                  status: response.statusCode ?? 0,
                  body: Buffer.concat(chunks).toString('utf8')
               })
            );
         }
      );

      clientRequest.on('error', reject);
      clientRequest.end();
   });
}

function createTestProtection(available: boolean): SecretProtection {
   return {
      isEncryptionAvailable: () => available,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (plainText) => Buffer.from(`protected:${Buffer.from(plainText).toString('base64')}`),
      decryptString: (encrypted) => Buffer.from(encrypted.toString().slice('protected:'.length), 'base64').toString()
   };
}

const bridgeModZip = buildZipArchive([{ name: 'Plugins/BSML.dll', data: 'bsml' }]);
const bridgeModHash = md5(bridgeModZip);
const bridgeCatalog = {
   mods: [
      {
         mod: {
            id: 2,
            name: 'BSML',
            summary: 'the ui library',
            category: 'library',
            authors: [{ displayName: 'monkeymanboy' }]
         },
         latest: {
            id: 20,
            modId: 2,
            modVersion: '1.6.0',
            zipHash: bridgeModHash,
            fileSize: bridgeModZip.byteLength,
            contentHashes: [{ path: 'Plugins/BSML.dll', hash: md5('bsml') }]
         }
      }
   ]
};

function fakeBeatMods(url: string) {
   if (url.includes('/api/hashlookup')) return Promise.resolve(Response.json({ modVersions: [] }));

   return Promise.resolve(Response.json(url.includes('/api/status') ? { status: 'ok' } : bridgeCatalog));
}

const fakeModCdn: ContentFetch = (url) =>
   Promise.resolve(
      url === beatModsDownloadUrl(bridgeModHash) ? new Response(new Uint8Array(bridgeModZip)) : new Response('not found', { status: 404 })
   );

function md5(value: string | Buffer) {
   return createHash('md5').update(value).digest('hex');
}
