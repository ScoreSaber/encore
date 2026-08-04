import { Result } from 'better-result';

import type { IpcError } from '@/app/ipc/core';
import { hasSnapshotStream, type TargetApiModule } from '@/lib/api';
import { causeFailure } from '@/lib/errors';
import type { SecretStoreAvailability } from '@/lib/security/secret-store';
import type { ReceiverActionResult, ReceiverListenAddress, ReceiverPairingResult, ReceiverState } from '@/modules/receiver/contract';
import { listLanAddresses, wildcardInterfaceName, type LanAddress } from '@/modules/receiver/main/lan';
import { createReceiverEventHub } from '@/modules/receiver/main/receiver-events';
import type { ReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverPairingController } from '@/modules/receiver/main/receiver-pairing';
import { coreRoutes } from '@/modules/receiver/main/routes/core-routes';
import { createReceiverRequestHandler } from '@/modules/receiver/main/routes/route-table';
import { defineReceiverApiRoutes } from '@/modules/receiver/main/target-api';
import { receiverDeviceNameSchema, receiverTargetCapabilities } from '@/modules/receiver/protocol';
import type { PairedDevice, SettingsSnapshot } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { Target } from '@/modules/targets/contract';
import { getLocalTarget } from '@/modules/targets/main/local-target';

import { createServer, type Server } from 'node:https';
import { hostname } from 'node:os';
import type { Duplex } from 'node:stream';

export const defaultReceiverPort = 38_567;
export const maxReceiverConnections = 64;
export const receiverHeadersTimeoutMs = 10_000;

type ReceiverServerOptions = {
   settingsStore: SettingsStore;
   identityStore: ReceiverIdentityStore;
   apiModules: readonly TargetApiModule[];
   getSecretStoreAvailability: () => SecretStoreAvailability;
   platform?: NodeJS.Platform;
   port?: number;
   listAddresses?: () => LanAddress[];
   heartbeatIntervalMs?: number;
};

type ActiveReceiverServer = {
   server: Server;
   sockets: Set<Duplex>;
   addresses: ReceiverListenAddress[];
};

export type ReceiverServerController = ReturnType<typeof createReceiverServer>;
export type ReceiverRemoteTarget = Target & { kind: 'remote' };
export type ReceiverRouteContext = ReturnType<typeof createReceiverRouteContext>;

function createReceiverRouteContext(
   pairing: ReturnType<typeof createReceiverPairingController>,
   events: ReturnType<typeof createReceiverEventHub>,
   platform: NodeJS.Platform
) {
   return {
      name: hostname(),
      pairing,
      events,
      getTarget: (): ReceiverRemoteTarget => {
         const local = getLocalTarget(platform);

         return {
            ...local,
            kind: 'remote',
            id: 'receiver-local',
            capabilities: local.capabilities.filter((capability) => receiverTargetCapabilities.includes(capability))
         };
      }
   };
}

export function createReceiverServer(options: ReceiverServerOptions) {
   const handleReceiverRequest = createReceiverRequestHandler([...coreRoutes, ...defineReceiverApiRoutes(options.apiModules)]);
   const port = options.port ?? defaultReceiverPort;
   const listAddresses = options.listAddresses ?? listLanAddresses;
   const events = createReceiverEventHub({
      heartbeatIntervalMs: options.heartbeatIntervalMs
   });
   const listeners = new Set<(state: ReceiverState) => void>();
   const pairing = createReceiverPairingController({
      settingsStore: options.settingsStore,
      onSessionChanged: (session) => {
         setState({ pairing: session });
      }
   });

   let activeServer: ActiveReceiverServer | null = null;
   let state: ReceiverState = {
      enabled: false,
      status: 'disabled',
      addresses: [],
      interfaces: [],
      pairing: null,
      identity: null,
      secureStorage: describeSecureStorage()
   };

   for (const module of options.apiModules) {
      if (!hasSnapshotStream(module)) continue;

      const subscribe = module.subscribe as (listener: (snapshot: unknown) => void) => () => void;
      subscribe((snapshot) => {
         events.broadcast({ type: 'snapshot', namespace: module.api.namespace, value: snapshot });
      });
   }

   const routeContext = createReceiverRouteContext(pairing, events, options.platform ?? process.platform);

   async function reconcile(snapshot?: SettingsSnapshot) {
      const settings = snapshot ?? (await options.settingsStore.getSnapshot());

      if (settings.app.receiver.enabled) {
         await start(settings);
         return;
      }

      await stop('disabled');
   }

   async function start(snapshot?: SettingsSnapshot): Promise<ReceiverActionResult> {
      const settings = snapshot ?? (await options.settingsStore.getSnapshot());
      const interfaces = listAddresses();

      if (activeServer) {
         setState({
            enabled: true,
            status: 'running',
            addresses: activeServer.addresses,
            interfaces
         });
         return okState();
      }

      const selected = selectInterface(interfaces, settings.app.receiver.interfaceName);
      if (!selected) {
         const message = settings.app.receiver.interfaceName
            ? `Network interface "${settings.app.receiver.interfaceName}" is not available`
            : 'No LAN interface is available';

         setState({
            enabled: true,
            status: 'error',
            addresses: [],
            interfaces,
            pairing: null,
            message
         });
         return errorResult('receiver.lan.unavailable', message);
      }

      setState({
         enabled: true,
         status: 'starting',
         addresses: [],
         interfaces,
         pairing: null,
         message: undefined
      });

      const identity = await options.identityStore.load();
      setState({
         identity: {
            fingerprint: identity.fingerprint,
            persisted: identity.persisted
         },
         secureStorage: describeSecureStorage()
      });

      const sockets = new Set<Duplex>();
      const server = createServer({ cert: identity.certificatePem, key: identity.privateKeyPem }, (request, response) => {
         void handleReceiverRequest(request, response, routeContext).catch(() => {
            if (!response.headersSent) response.writeHead(500);
            response.end();
         });
      });
      server.maxConnections = maxReceiverConnections;
      server.maxHeadersCount = 64;
      server.headersTimeout = receiverHeadersTimeoutMs;

      server.on('connection', (socket) => {
         sockets.add(socket);
         socket.on('close', () => {
            sockets.delete(socket);
         });
      });

      const listenResult = await Result.tryPromise({
         try: () => listenOn(server, selected, interfaces, port, sockets),
         catch: (cause): IpcError => ({
            code: 'receiver.listen.failed',
            message: causeFailure('Failed to start receiver', cause)
         })
      });

      if (Result.isError(listenResult)) {
         destroyServer(server, sockets);
         setState({
            enabled: true,
            status: 'error',
            addresses: [],
            interfaces,
            pairing: null,
            message: listenResult.error.message
         });

         return { ok: false, error: listenResult.error };
      }

      events.open();
      activeServer = listenResult.value;
      setState({
         enabled: true,
         status: 'running',
         addresses: activeServer.addresses,
         interfaces,
         pairing: null,
         message: undefined
      });

      return okState();
   }

   async function stop(status: ReceiverState['status'] = 'stopped'): Promise<ReceiverActionResult> {
      pairing.clear();
      events.closeAll();

      const server = activeServer;
      activeServer = null;

      if (server) await closeServer(server);

      setState({
         enabled: false,
         status,
         addresses: [],
         pairing: null,
         message: undefined
      });
      return okState();
   }

   function startPairing(): ReceiverPairingResult {
      if (!activeServer || state.status !== 'running') {
         return {
            ok: false,
            error: {
               code: 'receiver.not-running',
               message: 'Receiver is not running'
            }
         };
      }

      return {
         ok: true,
         value: pairing.start()
      };
   }

   async function renameDevice(deviceId: string, name: string): Promise<ReceiverActionResult> {
      const parsed = receiverDeviceNameSchema.safeParse(name);
      if (!parsed.success) return errorResult('receiver.device-name.invalid', 'Device name is required');

      const snapshot = await options.settingsStore.getSnapshot();
      if (!snapshot.app.receiver.pairedDevices.some((device) => device.id === deviceId)) {
         return errorResult('receiver.device.not-found', 'Paired device was not found');
      }

      return writePairedDevices((devices) => devices.map((device) => (device.id === deviceId ? { ...device, name: parsed.data } : device)));
   }

   async function revokeDevice(deviceId: string): Promise<ReceiverActionResult> {
      const written = await writePairedDevices((devices) => devices.filter((device) => device.id !== deviceId));
      events.closeDevice(deviceId);

      return written;
   }

   async function selectInterfaceName(interfaceName: string | null): Promise<ReceiverActionResult> {
      const interfaces = listAddresses();
      if (interfaceName !== null && !interfaces.some((candidate) => candidate.interfaceName === interfaceName)) {
         return errorResult('receiver.interface.not-found', 'Network interface is not available');
      }

      const written = await options.settingsStore.updateAppSettings({
         receiver: { interfaceName }
      });
      if (!written.ok) return { ok: false, error: written.error };

      if (activeServer) {
         await stop('starting');
         return start();
      }

      setState({ interfaces });
      return okState();
   }

   async function writePairedDevices(next: (devices: PairedDevice[]) => PairedDevice[]): Promise<ReceiverActionResult> {
      const written = await options.settingsStore.updateAppSettings((current) => ({
         receiver: { pairedDevices: next(current.receiver.pairedDevices) }
      }));

      if (!written.ok) return { ok: false, error: written.error };
      return okState();
   }

   function subscribe(listener: (state: ReceiverState) => void) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   function describeSecureStorage() {
      const availability = options.getSecretStoreAvailability();
      return availability.available ? { available: true } : { available: false, reason: availability.reason };
   }

   function setState(update: Partial<ReceiverState>) {
      state = { ...state, ...update };

      for (const listener of listeners) {
         listener(state);
      }
   }

   function okState(): ReceiverActionResult {
      return { ok: true, value: state };
   }

   function errorResult(code: string, message: string): ReceiverActionResult {
      return { ok: false, error: { code, message } };
   }

   return {
      reconcile,
      start,
      stop,
      getState: () => state,
      startPairing,
      renameDevice,
      revokeDevice,
      selectInterfaceName,
      subscribe
   };
}

export function selectInterface(interfaces: LanAddress[], interfaceName: string | null) {
   if (!interfaceName) return interfaces.find((candidate) => candidate.interfaceName !== wildcardInterfaceName) ?? null;

   return interfaces.find((candidate) => candidate.interfaceName === interfaceName) ?? null;
}

function listenOn(server: Server, address: LanAddress, interfaces: LanAddress[], port: number, sockets: Set<Duplex>) {
   return new Promise<ActiveReceiverServer>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, address.host, () => {
         server.removeListener('error', reject);

         const listening = server.address();
         const boundPort = typeof listening === 'object' && listening ? listening.port : port;

         const advertisedAddresses =
            address.interfaceName === wildcardInterfaceName
               ? interfaces.filter((candidate) => candidate.interfaceName !== wildcardInterfaceName)
               : [address];

         resolve({
            server,
            sockets,
            addresses: advertisedAddresses.map((candidate) => ({
               host: candidate.host,
               port: boundPort,
               url: `https://${candidate.host}:${boundPort}`,
               interfaceName: candidate.interfaceName
            }))
         });
      });
   });
}

async function closeServer(active: ActiveReceiverServer) {
   destroyServer(active.server, active.sockets);

   await Result.tryPromise({
      try: () =>
         new Promise<void>((resolve) => {
            active.server.close(() => {
               resolve();
            });
         }),
      catch: () => undefined
   });
}

function destroyServer(server: Server, sockets: Set<Duplex>) {
   for (const socket of sockets) {
      socket.destroy();
   }
   sockets.clear();

   server.closeAllConnections();
}
