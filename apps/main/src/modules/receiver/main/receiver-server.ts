import { Result } from 'better-result';
import { z } from 'zod';

import type { ApiImplementation } from '@/lib/api';
import { createProblem, type Problem } from '@/lib/errors';
import type { SecretStoreAvailability } from '@/lib/security/secret-store';
import { createSerialQueue } from '@/lib/state/machine';
import { receiverAddressUrl } from '@/modules/receiver/address';
import type { ReceiverListenAddress, ReceiverPairingSession, ReceiverState } from '@/modules/receiver/contract';
import { isPrivateAddress, listLanAddresses, type LanAddress } from '@/modules/receiver/main/lan';
import { createReceiverEventHub } from '@/modules/receiver/main/receiver-events';
import type { ReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverPairingController } from '@/modules/receiver/main/receiver-pairing';
import { coreRoutes } from '@/modules/receiver/main/routes/core-routes';
import { createReceiverRequestHandler } from '@/modules/receiver/main/routes/route-table';
import { defineReceiverApiRoutes } from '@/modules/receiver/main/target-api';
import { receiverAttachedTargetIdSchema, receiverTargetCapabilities } from '@/modules/receiver/protocol';
import type { PairedDevice, SettingsSnapshot } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { Target, TargetEvent } from '@/modules/targets/contract';
import { getLocalTarget } from '@/modules/targets/main/local-target';

import { createServer, type Server } from 'node:https';
import { isIP } from 'node:net';
import { hostname } from 'node:os';
import type { Duplex } from 'node:stream';

const maxReceiverConnections = 64;
const receiverHeadersTimeoutMs = 10_000;

type ReceiverServerOptions = {
   settingsStore: SettingsStore;
   identityStore: ReceiverIdentityStore;
   implementations: readonly ApiImplementation[];
   getSecretStoreAvailability: () => SecretStoreAvailability;
   getTarget?: () => Target;
   attached?: ReceiverAttachedTargets;
   name?: string;
   port?: number;
   listAddresses?: () => LanAddress[];
};

type ReceiverActionResult = Result<ReceiverState, Problem>;

type ActiveReceiverServer = {
   server: Server;
   sockets: Set<Duplex>;
   addresses: ReceiverListenAddress[];
   bindHost: string;
   requestedPort: number;
};

type ReceiverAttachedTargets = {
   listTargets: () => Target[];
   subscribe: (listener: (event: TargetEvent) => void) => () => void;
   implementations: readonly ApiImplementation[];
};

export type ReceiverServerController = ReturnType<typeof createReceiverServer>;
type ReceiverRemoteTarget = Target & { kind: 'remote' };
export type ReceiverRouteContext = ReturnType<typeof createReceiverRouteContext>;

function createReceiverRouteContext(
   pairing: ReturnType<typeof createReceiverPairingController>,
   events: ReturnType<typeof createReceiverEventHub>,
   getTarget: () => Target,
   listAttached: () => Target[],
   name: string
) {
   const servedCapabilities = (target: Target) => target.capabilities.filter((capability) => receiverTargetCapabilities.includes(capability));
   const getHostTarget = (): ReceiverRemoteTarget => {
      const local = getTarget();
      return { ...local, kind: 'remote', id: 'receiver-local', capabilities: servedCapabilities(local) };
   };
   const getAttachedTargets = () =>
      listAttached().flatMap((target) =>
         target.kind === 'quest' && receiverAttachedTargetIdSchema.safeParse(target.id).success
            ? [{ ...target, kind: target.kind, capabilities: servedCapabilities(target) }]
            : []
      );

   return {
      name,
      pairing,
      events,
      getTargets: () => ({ target: getHostTarget(), attached: getAttachedTargets() }),
      resolveTarget: (targetId: string | undefined) => {
         if (targetId === undefined) return { targetId: getTarget().id, capabilities: getHostTarget().capabilities, attached: false };

         const target = getAttachedTargets().find((candidate) => candidate.id === targetId);
         return target ? { targetId: target.id, capabilities: target.capabilities, attached: true } : null;
      },
      servesTarget: (targetId: string) => targetId === getTarget().id || getAttachedTargets().some((target) => target.id === targetId)
   };
}

export function createReceiverServer(options: ReceiverServerOptions) {
   const getTarget = options.getTarget ?? getLocalTarget;
   const attached = options.attached;
   const handleReceiverRequest = createReceiverRequestHandler([
      ...coreRoutes,
      ...defineReceiverApiRoutes({ host: options.implementations, attached: attached?.implementations ?? [] })
   ]);
   const listAddresses = options.listAddresses ?? listLanAddresses;
   const events = createReceiverEventHub((connectedDevices) => setState({ connectedDevices }));
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
      secureStorage: describeSecureStorage(),
      connectedDevices: []
   };

   const routeContext = createReceiverRouteContext(pairing, events, getTarget, () => attached?.listTargets() ?? [], options.name ?? hostname());

   for (const { api, subscribe } of options.implementations) {
      subscribe?.((event) => {
         if (event.targetId === getTarget().id) events.broadcast({ type: 'snapshot', namespace: api.namespace, value: event.snapshot });
      });
   }
   for (const { api, subscribe } of attached?.implementations ?? []) {
      subscribe?.((event) => {
         if (routeContext.resolveTarget(event.targetId)?.attached) {
            events.broadcast({ type: 'snapshot', namespace: api.namespace, targetId: event.targetId, value: event.snapshot });
         }
      });
   }
   attached?.subscribe(() => events.broadcast({ type: 'target', ...routeContext.getTargets() }));
   const lifecycle = createSerialQueue();

   function schedule(action: () => Promise<ReceiverActionResult>) {
      return lifecycle.run(action);
   }

   function start(snapshot?: SettingsSnapshot) {
      return schedule(() => startServer(snapshot));
   }

   function stop(status: ReceiverState['status'] = 'stopped') {
      return schedule(() => stopServer(status));
   }

   async function reconcile(snapshot?: SettingsSnapshot) {
      await schedule(async () => {
         const settings = snapshot ?? (await options.settingsStore.getSnapshot());
         return settings.app.receiver.enabled ? startServer(settings) : stopServer('disabled');
      });
   }

   async function closeActiveServer() {
      pairing.clear();
      events.closeAll();

      const server = activeServer;
      activeServer = null;

      if (server) await closeServer(server);
   }

   async function startServer(snapshot?: SettingsSnapshot): Promise<ReceiverActionResult> {
      const settings = snapshot ?? (await options.settingsStore.getSnapshot());
      const interfaces = listAddresses();
      const receiverSettings = settings.app.receiver;
      const port = options.port ?? receiverSettings.port;
      const selected = receiverSettings.bindHost
         ? { host: receiverSettings.bindHost, interfaceName: 'custom' }
         : selectInterface(interfaces, receiverSettings.interfaceName);

      if (activeServer && activeServer.bindHost === selected?.host && activeServer.requestedPort === port) {
         setState({
            enabled: true,
            status: 'running',
            addresses: activeServer.addresses,
            interfaces,
            message: undefined
         });
         return okState();
      }

      if (activeServer) await closeActiveServer();
      if (!selected) {
         const problem = receiverSettings.interfaceName
            ? createProblem('receiver.lan.interface-missing', { interfaceName: receiverSettings.interfaceName })
            : createProblem('receiver.lan.unavailable');

         setState({
            enabled: true,
            status: 'error',
            addresses: [],
            interfaces,
            pairing: null,
            message: problem.message
         });
         return Result.err(problem);
      }

      setState({
         enabled: true,
         status: 'starting',
         addresses: [],
         interfaces,
         pairing: null,
         message: undefined
      });

      const identityResult = await Result.tryPromise({
         try: () => options.identityStore.load(),
         catch: (cause) => createProblem('receiver.listen.failed', { cause })
      });
      if (Result.isError(identityResult)) {
         setState({
            enabled: true,
            status: 'error',
            addresses: [],
            interfaces,
            pairing: null,
            message: identityResult.error.message
         });
         return Result.err(identityResult.error);
      }

      const identity = identityResult.value;
      setState({
         identity: {
            fingerprint: identity.fingerprint,
            persisted: identity.persisted
         },
         secureStorage: describeSecureStorage()
      });

      const sockets = new Set<Duplex>();
      const server = createServer({ cert: identity.certificatePem, key: identity.privateKeyPem }, (request, response) => {
         void Result.tryPromise({
            try: () => handleReceiverRequest(request, response, routeContext),
            catch: () => {
               if (!response.headersSent) response.writeHead(500);
               response.end();
            }
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
         catch: (cause) => createProblem('receiver.listen.failed', { cause })
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

         return Result.err(listenResult.error);
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

   async function stopServer(status: ReceiverState['status']): Promise<ReceiverActionResult> {
      await closeActiveServer();

      setState({
         enabled: false,
         status,
         addresses: [],
         pairing: null,
         message: undefined
      });
      return okState();
   }

   function startPairing(): Result<ReceiverPairingSession, Problem> {
      if (!activeServer || state.status !== 'running') return Result.err(createProblem('receiver.not-running'));

      return Result.ok(pairing.start());
   }

   async function renameDevice(deviceId: string, name: string): Promise<ReceiverActionResult> {
      const snapshot = await options.settingsStore.getSnapshot();
      if (!snapshot.app.receiver.pairedDevices.some((device) => device.id === deviceId)) {
         return Result.err(createProblem('receiver.device.not-found'));
      }

      return writePairedDevices((devices) => devices.map((device) => (device.id === deviceId ? { ...device, name } : device)));
   }

   async function revokeDevice(deviceId: string): Promise<ReceiverActionResult> {
      const written = await writePairedDevices((devices) => devices.filter((device) => device.id !== deviceId));
      events.closeDevice(deviceId);

      return written;
   }

   function selectInterfaceName(interfaceName: string | null): Promise<ReceiverActionResult> {
      return schedule(async () => {
         const interfaces = listAddresses();
         if (interfaceName !== null && !interfaces.some((candidate) => candidate.interfaceName === interfaceName)) {
            return Result.err(createProblem('receiver.interface.not-found'));
         }

         const written = await options.settingsStore.updateAppSettings({
            receiver: { interfaceName, bindHost: null }
         });
         if (!written.ok) return Result.err(written.error);

         if (written.value.app.receiver.enabled) {
            return startServer(written.value);
         }

         setState({ interfaces });
         return okState();
      });
   }

   async function writePairedDevices(next: (devices: PairedDevice[]) => PairedDevice[]): Promise<ReceiverActionResult> {
      const written = await options.settingsStore.updateAppSettingsWith((current) => ({
         receiver: { pairedDevices: next(current.receiver.pairedDevices) }
      }));

      if (!written.ok) return Result.err(written.error);
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
      return Result.ok(state);
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

function selectInterface(interfaces: LanAddress[], interfaceName: string | null) {
   if (!interfaceName) return interfaces.find((candidate) => isPrivateAddress(candidate.host)) ?? null;

   return interfaces.find((candidate) => candidate.interfaceName === interfaceName) ?? null;
}

function listenOn(server: Server, address: LanAddress, interfaces: LanAddress[], port: number, sockets: Set<Duplex>) {
   return new Promise<ActiveReceiverServer>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, address.host, () => {
         server.removeListener('error', reject);

         const listening = server.address();
         const addressInfo = z.object({ port: z.number() }).safeParse(listening);
         const boundPort = addressInfo.success ? addressInfo.data.port : port;

         const advertisedAddresses = isWildcardAddress(address.host)
            ? interfaces.filter((candidate) => !isWildcardAddress(candidate.host) && (address.host === '::' || isIP(candidate.host) === 4))
            : [address];

         resolve({
            server,
            sockets,
            bindHost: address.host,
            requestedPort: port,
            addresses: advertisedAddresses.map((candidate) => ({
               host: candidate.host,
               port: boundPort,
               url: receiverAddressUrl({ host: candidate.host, port: boundPort }),
               interfaceName: candidate.interfaceName
            }))
         });
      });
   });
}

function isWildcardAddress(host: string) {
   return host === '0.0.0.0' || host === '::';
}

async function closeServer(active: ActiveReceiverServer) {
   destroyServer(active.server, active.sockets);

   await new Promise<void>((resolve) => {
      active.server.close(() => {
         resolve();
      });
   });
}

function destroyServer(server: Server, sockets: Set<Duplex>) {
   for (const socket of sockets) {
      socket.destroy();
   }
   sockets.clear();

   server.closeAllConnections();
}
