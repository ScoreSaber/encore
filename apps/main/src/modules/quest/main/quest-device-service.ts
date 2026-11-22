import { Result } from 'better-result';

import { createAdbClient, type AdbClient, type AdbDevice, type AdbDeviceState } from '@/lib/android/adb';
import type { AdbProvisioner } from '@/lib/android/adb-provisioner';
import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import {
   createEmptyInstallRegistrySnapshot,
   type InstallDetail,
   type InstallRegistrySnapshot,
   type InstallSummary
} from '@/modules/installs/contract';
import {
   beatSaberPackageId,
   encorePackageId,
   type QuestConnectionStatus,
   type QuestEnableWirelessRequest,
   type QuestPairingRequest,
   questInstallId,
   type QuestState,
   type QuestWirelessRequest
} from '@/modules/quest/contract';
import { validateCompanionApk } from '@/modules/quest/main/quest-companion';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { readBackupState } from '@/modules/quest/main/quest-patch-backup';
import { questModDataDir, questSavedPlayerDataPath, questScotland2Path } from '@/modules/quest/main/quest-paths';
import { questTargetIdPrefix, type Target, type TargetEvent, type TargetId } from '@/modules/targets/contract';

import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const pollIntervalMs = 10_000;
const maxFailedPolls = 3;
const questProducts = new Set(['monterey', 'hollywood', 'seacliff', 'eureka', 'panther']);
const adbServerCantConnect = /unable to start pairing client|failed to connect|unable to connect|connection refused|no route to host|timed out/i;

type QuestDeviceSnapshot = {
   physicalId: string;
   serial: string;
   state: AdbDeviceState;
   model: string | null;
   gameVersion: string | null;
   modloaderInstalled: boolean;
   gameRunning: boolean;
   recoveryAvailable: boolean;
   savedPlayerData: boolean;
   companionInstalled: boolean;
   firstSeenAt: string;
};

export type QuestConnection = {
   client: AdbClient;
   serial: string;
   gameVersion: string | null;
   modloaderInstalled: boolean;
};

export type QuestDeviceService = ReturnType<typeof createQuestDeviceService>;

type ServiceLifecycle = 'stopped' | 'running' | 'disposed';
type ClientState =
   | { status: 'uninitialized' }
   | { status: 'resolving'; promise: Promise<Result<AdbClient, Problem>> }
   | { status: 'ready'; client: AdbClient };

export function createQuestDeviceService(options: {
   provisioner: Pick<AdbProvisioner, 'resolve'>;
   createClient?: (adbPath: string) => AdbClient;
   mutations: QuestMutationLock;
}) {
   const createClient = options.createClient ?? ((adbPath: string) => createAdbClient({ adbPath }));
   const listeners = new Set<(event: TargetEvent) => void>();
   const devices = new Map<string, QuestDeviceSnapshot>();
   const identitiesByTransport = new Map<string, string>();

   let lifecycle: ServiceLifecycle = 'stopped';
   const isDisposed = () => lifecycle === 'disposed';
   let clientState: ClientState = { status: 'uninitialized' };
   let timer: ReturnType<typeof setInterval> | null = null;
   let refreshing: Promise<void> | null = null;
   let queuedRefresh: Promise<void> | null = null;
   let queuedForce = false;
   let failedPolls = 0;
   let error: Problem | null = null;

   function start() {
      if (lifecycle !== 'stopped') return;
      lifecycle = 'running';

      timer = setInterval(() => {
         void triggerRefresh(false);
      }, pollIntervalMs);
      void triggerRefresh(false);
   }

   function dispose() {
      lifecycle = 'disposed';
      if (timer) clearInterval(timer);
      timer = null;
      listeners.clear();
   }

   function refresh(): Promise<void> {
      return triggerRefresh(true);
   }

   function triggerRefresh(force: boolean): Promise<void> {
      if (isDisposed()) return Promise.resolve();
      if (!refreshing) {
         refreshing = poll(force).finally(() => {
            refreshing = null;
         });
         return refreshing;
      }
      if (force) queuedForce = true;
      queuedRefresh ??= refreshing.then(() => {
         const nextForce = queuedForce;
         queuedForce = false;
         queuedRefresh = null;
         return isDisposed() ? Promise.resolve() : triggerRefresh(nextForce);
      });
      return queuedRefresh;
   }

   async function poll(force: boolean) {
      if (isDisposed()) return;
      const resolved = await ensureClient();
      if (isDisposed()) return;
      if (Result.isError(resolved)) {
         error = resolved.error;
         replaceDevices([]);
         return;
      }
      const activeClient = resolved.value;
      const listed = await activeClient.listDevices();
      if (isDisposed()) return;
      if (Result.isError(listed)) {
         error = listed.error;
         failedPolls += 1;
         if (failedPolls >= maxFailedPolls) replaceDevices([]);
         return;
      }
      error = null;
      failedPolls = 0;

      const next = new Map<string, QuestDeviceSnapshot>();
      for (const device of listed.value) {
         if (isDisposed()) return;
         let model = device.model?.replaceAll('_', ' ') ?? null;
         let product = device.product;
         if (device.state === 'device' && !isQuestDevice(device)) {
            if (model && product) continue;
            const identified = await Promise.all([activeClient.deviceModel(device.serial), activeClient.deviceProduct(device.serial)]);
            model = Result.isOk(identified[0]) ? identified[0].value : model;
            product = Result.isOk(identified[1]) ? identified[1].value : product;
            if (!isQuestDevice({ ...device, model, product })) continue;
         }

         const hardware = device.state === 'device' ? await activeClient.hardwareSerial(device.serial) : null;
         const physicalId =
            hardware && Result.isOk(hardware) && hardware.value ? hardware.value : (identitiesByTransport.get(device.serial) ?? device.serial);
         identitiesByTransport.set(device.serial, physicalId);
         const previous = devices.get(physicalId);
         const targetId = `${questTargetIdPrefix}${physicalId}`;
         if (!force && previous && device.state === 'device' && options.mutations.isHeld(targetId)) {
            const preserved: QuestDeviceSnapshot = { ...previous, serial: device.serial, state: device.state, model: model ?? previous.model };
            const selected = next.get(physicalId);
            if (!selected || transportPriority(preserved) > transportPriority(selected)) next.set(physicalId, preserved);
            continue;
         }

         const snapshot: QuestDeviceSnapshot = {
            physicalId,
            serial: device.serial,
            state: device.state,
            model: model ?? previous?.model ?? null,
            gameVersion: previous?.gameVersion ?? null,
            modloaderInstalled: previous?.modloaderInstalled ?? false,
            gameRunning: false,
            recoveryAvailable: false,
            savedPlayerData: previous?.savedPlayerData ?? false,
            companionInstalled: previous?.companionInstalled ?? false,
            firstSeenAt: previous?.firstSeenAt ?? new Date().toISOString()
         };

         if (device.state === 'device') {
            const [gameVersion, modloader, patched, gameRunning, backup, savedPlayerData, companion] = await Promise.all([
               activeClient.packageVersionName(device.serial, beatSaberPackageId),
               activeClient.fileExists(device.serial, questScotland2Path),
               activeClient.packagePatched(device.serial, beatSaberPackageId),
               activeClient.packageRunning(device.serial, beatSaberPackageId),
               readBackupState({ client: activeClient, serial: device.serial }),
               activeClient.fileExists(device.serial, questSavedPlayerDataPath),
               activeClient.packageVersionName(device.serial, encorePackageId)
            ]);

            if (Result.isOk(gameVersion)) snapshot.gameVersion = gameVersion.value;
            if (Result.isOk(modloader) && Result.isOk(patched)) snapshot.modloaderInstalled = modloader.value && patched.value;
            snapshot.gameRunning = Result.isOk(gameRunning) ? gameRunning.value : (previous?.gameRunning ?? false);
            if (Result.isOk(savedPlayerData)) snapshot.savedPlayerData = savedPlayerData.value;
            if (Result.isOk(companion)) snapshot.companionInstalled = companion.value !== null;
            if (Result.isError(backup)) snapshot.recoveryAvailable = previous?.recoveryAvailable ?? false;
            else if (backup.value.complete && backup.value.apk && !snapshot.modloaderInstalled) {
               if (snapshot.gameVersion) {
                  snapshot.recoveryAvailable =
                     backup.value.version === snapshot.gameVersion || backup.value.downgradeVersion === snapshot.gameVersion;
               } else {
                  const installed = await activeClient.packageApkPath(device.serial, beatSaberPackageId);
                  snapshot.recoveryAvailable = Result.isOk(installed) && !installed.value;
               }
            }
         }

         const selected = next.get(physicalId);
         if (!selected || transportPriority(snapshot) > transportPriority(selected)) next.set(physicalId, snapshot);
      }

      if (isDisposed()) return;
      replaceDevices([...next.values()]);
   }

   function ensureClient(): Promise<Result<AdbClient, Problem>> {
      if (clientState.status === 'ready') return Promise.resolve(Result.ok(clientState.client));
      if (clientState.status === 'resolving') return clientState.promise;

      const promise = options.provisioner.resolve().then((resolved) => {
         if (Result.isError(resolved)) {
            error = resolved.error;
            clientState = { status: 'uninitialized' };
            return Result.err(resolved.error);
         }
         const created = createClient(resolved.value);
         clientState = { status: 'ready', client: created };
         return Result.ok(created);
      });
      clientState = { status: 'resolving', promise };
      return promise;
   }

   function getConnectionStatus(): QuestConnectionStatus {
      return { adbReady: clientState.status === 'ready', error: error ? { code: error.code, message: error.message } : null };
   }

   function connectWireless(request: QuestWirelessRequest) {
      return Result.gen(async function* () {
         const adb = yield* Result.await(ensureClient());
         yield* Result.await(adb.connect(request.endpoint));
         await refresh();
         return Result.ok({ endpoint: request.endpoint });
      });
   }

   function pairWireless(request: QuestPairingRequest) {
      return Result.gen(async function* () {
         const adb = yield* Result.await(ensureClient());
         const host = request.host.includes(':') ? `[${request.host}]` : request.host;
         const endpointFor = (port: number | null) => (port === null ? null : `${host}:${port}`);
         let endpoint = endpointFor(request.connectionPort ?? (await adb.mdnsConnectPort(request.host)));

         if (!endpoint || Result.isError(await connectReady(adb, endpoint))) {
            yield* Result.await(pair(adb, request, `${host}:${request.pairingPort}`));
            for (const waitMs of [0, 500, 1000, 2000]) {
               if (endpoint) break;
               await delay(waitMs);
               endpoint = endpointFor(await adb.mdnsConnectPort(request.host));
            }
            if (!endpoint) return Result.err(createProblem('quest.wireless.no-connect-port'));
            yield* Result.await(connectReady(adb, endpoint));
         }
         await refresh();
         return Result.ok({ endpoint });
      });
   }

   async function pair(adb: AdbClient, request: QuestPairingRequest, endpoint: string) {
      const paired = await adb.pair(endpoint, request.pairingCode);
      if (Result.isOk(paired)) return paired;
      const blocked = await unreachable(request.host, request.pairingPort);
      if (blocked) return Result.err(blocked);
      if (!adbServerCantConnect.test(paired.error.detail ?? '') || options.mutations.busy()) return paired;
      await adb.killServer();
      return adb.pair(endpoint, request.pairingCode);
   }

   async function unreachable(host: string, port: number): Promise<Problem | null> {
      const code = await new Promise<string | null>((resolve) => {
         const socket = connect({ host, port, timeout: 3_000 });
         const settle = (result: string | null) => {
            socket.destroy();
            resolve(result);
         };
         socket.once('connect', () => settle(null));
         socket.once('timeout', () => settle('ETIMEDOUT'));
         socket.once('error', (cause: NodeJS.ErrnoException) => settle(cause.code ?? null));
      });
      if (code !== 'EHOSTUNREACH' && code !== 'ENETUNREACH' && code !== 'ETIMEDOUT') return null;
      return process.platform === 'darwin' && code === 'EHOSTUNREACH'
         ? createProblem('quest.wireless.blocked', { cause: code })
         : createProblem('quest.wireless.unreachable', { host, cause: code });
   }

   async function connectReady(adb: AdbClient, endpoint: string): Promise<Result<void, Problem>> {
      const connected = await adb.connect(endpoint);
      if (Result.isError(connected)) return connected;
      for (const waitMs of [250, 500, 1000]) {
         const listed = await adb.listDevices();
         const state = Result.isOk(listed) ? listed.value.find((device) => device.serial === endpoint)?.state : undefined;
         if (state === 'device') {
            await adb.shell(endpoint, 'settings put global adb_allowed_connection_time 0');
            return Result.ok();
         }
         if (state !== 'offline') break;
         await delay(waitMs);
      }
      await adb.disconnect(endpoint);
      return Result.err(createProblem('quest.wireless.not-ready'));
   }

   function disableWireless(targetId: TargetId) {
      return withLock(targetId, () =>
         Result.gen(async function* () {
            const { client: adb, serial } = yield* getConnection(targetId);
            yield* Result.await(adb.shell(serial, 'settings put global adb_wifi_enabled 0'));
            await adb.disconnect(serial);
            await refresh();
            return Result.ok({ endpoint: serial });
         })
      );
   }

   function enableWireless(request: QuestEnableWirelessRequest) {
      return withLock(request.targetId, () => enableWirelessUnlocked(request));
   }

   function enableWirelessUnlocked(request: QuestEnableWirelessRequest) {
      return Result.gen(async function* () {
         const { client: adb, serial } = yield* getConnection(request.targetId);
         const address = yield* Result.await(adb.wirelessAddress(serial));
         yield* Result.await(adb.tcpip(serial, request.port));
         const endpoint = `${address}:${request.port}`;
         let connected = await connectReady(adb, endpoint);
         for (const waitMs of [250, 500, 1000]) {
            if (Result.isOk(connected)) break;
            await delay(waitMs);
            connected = await connectReady(adb, endpoint);
         }
         yield* connected;
         await refresh();
         return Result.ok({ endpoint });
      });
   }

   function installCompanion(targetId: TargetId, localPath: string) {
      return withLock(targetId, () =>
         Result.gen(async function* () {
            const { client: adb } = yield* getConnection(targetId);
            yield* Result.await(validateCompanionApk(localPath));
            const { endpoint } = yield* Result.await(enableWirelessUnlocked({ targetId, port: 5555 }));
            yield* Result.await(adb.installCompanion(endpoint, localPath));
            await adb.shell(endpoint, `pm grant ${encorePackageId} android.permission.WRITE_SECURE_SETTINGS`);
            return adb.startPackage(endpoint, encorePackageId);
         })
      );
   }

   async function withLock<Value>(targetId: TargetId, run: () => Promise<Result<Value, Problem>>): Promise<Result<Value, Problem>> {
      const job = options.mutations.acquire(targetId);
      if (Result.isError(job)) return job;
      try {
         return await run();
      } finally {
         job.value.release();
      }
   }

   function replaceDevices(next: QuestDeviceSnapshot[]) {
      const nextIds = new Set(next.map((device) => device.physicalId));

      for (const physicalId of devices.keys()) {
         if (nextIds.has(physicalId)) continue;

         devices.delete(physicalId);
         emit({ type: 'target-removed', targetId: `${questTargetIdPrefix}${physicalId}` });
      }

      for (const device of next) {
         const previous = devices.get(device.physicalId);
         devices.set(device.physicalId, device);

         const target = toTarget(device);
         if (
            !previous ||
            JSON.stringify(toTarget(previous)) !== JSON.stringify(target) ||
            previous.gameVersion !== device.gameVersion ||
            previous.gameRunning !== device.gameRunning ||
            previous.recoveryAvailable !== device.recoveryAvailable ||
            previous.savedPlayerData !== device.savedPlayerData ||
            previous.companionInstalled !== device.companionInstalled ||
            previous.modloaderInstalled !== device.modloaderInstalled
         ) {
            emit({ type: 'target-updated', target });
         }
      }
   }

   function emit(event: TargetEvent) {
      for (const listener of listeners) listener(event);
   }

   function subscribe(listener: (event: TargetEvent) => void) {
      listeners.add(listener);
      return () => {
         listeners.delete(listener);
      };
   }

   function deviceFor(targetId: TargetId) {
      if (!targetId.startsWith(questTargetIdPrefix)) return null;

      return devices.get(targetId.slice(questTargetIdPrefix.length)) ?? null;
   }

   function listTargets(): Target[] {
      return [...devices.values()].map(toTarget);
   }

   function listInstalls(targetId: TargetId): InstallRegistrySnapshot {
      const device = deviceFor(targetId);
      if (!device || device.state !== 'device' || (!device.gameVersion && !device.recoveryAvailable)) {
         return createEmptyInstallRegistrySnapshot(questModDataDir);
      }

      return {
         installRoot: questModDataDir,
         scannedAt: new Date().toISOString(),
         installs: [installSummary(device)],
         problems: []
      };
   }

   function getInstall(targetId: TargetId, installId: string): InstallDetail | null {
      const device = deviceFor(targetId);
      if (installId !== questInstallId || !device || device.state !== 'device' || (!device.gameVersion && !device.recoveryAvailable)) return null;

      return { ...installSummary(device), aliases: [] };
   }

   function getState(targetId: TargetId): QuestState {
      const device = deviceFor(targetId);
      return {
         modded: device?.modloaderInstalled ?? false,
         savedPlayerData: device?.savedPlayerData ?? false,
         companionInstalled: device?.companionInstalled ?? false
      };
   }

   function getConnection(targetId: TargetId): Result<QuestConnection, Problem> {
      const device = deviceFor(targetId);
      if (clientState.status !== 'ready' || !device || device.state !== 'device') {
         return Result.err(createProblem('quest.device.unavailable'));
      }

      return Result.ok({
         client: clientState.client,
         serial: device.serial,
         gameVersion: device.gameVersion,
         modloaderInstalled: device.modloaderInstalled
      });
   }

   return {
      start,
      dispose,
      refresh,
      subscribe,
      listTargets,
      listInstalls,
      getInstall,
      getState,
      getConnection,
      getConnectionStatus,
      connectWireless,
      pairWireless,
      disableWireless,
      enableWireless,
      installCompanion
   };
}

function toTarget(device: QuestDeviceSnapshot): Target {
   const ready = device.state === 'device';

   const target: Target = {
      id: `${questTargetIdPrefix}${device.physicalId}`,
      kind: 'quest',
      name: device.model ?? 'Meta Quest',
      status: ready ? 'ready' : device.state === 'unauthorized' ? 'unpaired' : 'disconnected',
      capabilities: ready ? ['list-installs', 'manage-installs', 'manage-mods', 'manage-maps', 'patch-game', 'launch-install', 'run-operations'] : []
   };
   if (isWireless(device.serial)) target.address = device.serial;
   if (device.state === 'unauthorized') target.message = translate('quest.offline.unpaired');
   return target;
}

function transportPriority(device: QuestDeviceSnapshot) {
   return (device.state === 'device' ? 2 : 0) + (isWireless(device.serial) ? 0 : 1);
}

function isWireless(serial: string) {
   return serial.includes(':') || serial.includes('._tcp');
}

function installSummary(device: QuestDeviceSnapshot): InstallSummary {
   const now = new Date().toISOString();

   return {
      id: questInstallId,
      name: device.gameVersion?.replace(/_\d+$/, '') ?? 'Beat Saber',
      pinned: false,
      version: device.gameVersion,
      store: null,
      source: 'store',
      path: questModDataDir,
      color: null,
      status: device.recoveryAvailable ? 'incomplete' : device.gameVersion ? 'ready' : 'missing',
      createdAt: device.firstSeenAt,
      updatedAt: now
   };
}

function isQuestDevice(device: Pick<AdbDevice, 'model' | 'product'>) {
   if (device.model && /quest/i.test(device.model)) return true;
   return device.product !== null && questProducts.has(device.product.toLowerCase());
}
