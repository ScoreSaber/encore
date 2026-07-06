import { Result } from 'better-result';

import { listLanAddresses } from '@/main/receiver/lan';
import { createPairingCode, createReceiverToken, hashReceiverToken, receiverTokenHashesEqual } from '@/main/receiver/tokens';
import type { SettingsStore } from '@/main/settings/settings-store';
import type { IpcError, IpcSerializable } from '@/shared/ipc/core';
import {
   receiverCapabilitiesResponseSchema,
   receiverDeviceNameSchema,
   receiverHealthResponseSchema,
   receiverPairCompleteRequestSchema,
   receiverPairCompleteResponseSchema,
   receiverPairStartRequestSchema,
   receiverPairStartResponseSchema,
   receiverProtocolVersion,
   type ReceiverCapabilitiesResponse,
   type ReceiverHealthResponse,
   type ReceiverPairCompleteResponse,
   type ReceiverPairingResult
} from '@/shared/receiver';
import type { ReceiverActionResult, ReceiverListenAddress, ReceiverPairingSession, ReceiverState } from '@/shared/receiver';
import type { PairedDevice, SettingsSnapshot } from '@/shared/settings';
import type { Target, TargetCapability } from '@/shared/targets';

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { hostname } from 'node:os';

const receiverPort = 38_567;
const pairingTtlMs = 2 * 60 * 1_000;
const maxJsonBodyBytes = 32 * 1_024;
const receiverTargetId = 'receiver-local';
const receiverCapabilities: TargetCapability[] = [];

type ReceiverServerOptions = {
   settingsStore: SettingsStore;
};

type ReceiverListener = (state: ReceiverState) => void;

type ActiveReceiverServer = {
   server: Server;
   sockets: Set<Socket>;
   eventResponses: Set<ServerResponse>;
   addresses: ReceiverListenAddress[];
};

type PendingPairing = ReceiverPairingSession & {
   codeHash: string;
   timer: ReturnType<typeof setTimeout>;
};

type HttpFailure = {
   status: number;
   code: string;
   message: string;
};

export type ReceiverServerController = ReturnType<typeof createReceiverServer>;

export function createReceiverServer(options: ReceiverServerOptions) {
   let activeServer: ActiveReceiverServer | null = null;
   let pendingPairing: PendingPairing | null = null;
   const listeners = new Set<ReceiverListener>();
   let state: ReceiverState = {
      enabled: false,
      status: 'disabled',
      addresses: [],
      pairing: null
   };

   async function reconcile(snapshot?: SettingsSnapshot) {
      const settings = snapshot ?? (await options.settingsStore.getSnapshot());

      if (settings.app.receiver.enabled) {
         await start();
         return;
      }

      await stop('disabled');
   }

   async function start(): Promise<ReceiverActionResult> {
      if (activeServer) {
         setState({
            enabled: true,
            status: 'running',
            addresses: activeServer.addresses
         });
         return okState();
      }

      const [lanAddress] = listLanAddresses();
      if (!lanAddress) {
         setState({
            enabled: true,
            status: 'error',
            addresses: [],
            pairing: null,
            message: 'No LAN interface is available'
         });

         return errorState('receiver.lan.unavailable', 'No LAN interface is available');
      }

      setState({
         enabled: true,
         status: 'starting',
         addresses: [],
         pairing: null,
         message: undefined
      });

      const server = createServer((request, response) => {
         void handleRequest(request, response);
      });
      const sockets = new Set<Socket>();
      const eventResponses = new Set<ServerResponse>();

      server.on('connection', (socket) => {
         sockets.add(socket);
         socket.on('close', () => {
            sockets.delete(socket);
         });
      });

      const listenResult = await Result.tryPromise({
         try: () => listenOnLanAddress(server, lanAddress, eventResponses, sockets),
         catch: (cause): IpcError => ({
            code: 'receiver.listen.failed',
            message: cause instanceof Error ? `Failed to start receiver: ${cause.message}` : `Failed to start receiver: ${String(cause)}`
         })
      });

      if (Result.isError(listenResult)) {
         destroyServer(server, sockets, eventResponses);
         setState({
            enabled: true,
            status: 'error',
            addresses: [],
            pairing: null,
            message: listenResult.error.message
         });

         return {
            ok: false,
            error: listenResult.error
         };
      }

      activeServer = listenResult.value;
      setState({
         enabled: true,
         status: 'running',
         addresses: activeServer.addresses,
         pairing: null,
         message: undefined
      });

      return okState();
   }

   async function stop(status: ReceiverState['status'] = 'stopped'): Promise<ReceiverActionResult> {
      clearPairing();

      const server = activeServer;
      activeServer = null;

      if (server) {
         await closeServer(server);
      }

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

      clearPairing();

      const code = createPairingCode();
      const pairing: ReceiverPairingSession = {
         code,
         expiresAt: new Date(Date.now() + pairingTtlMs).toISOString()
      };

      pendingPairing = {
         ...pairing,
         codeHash: hashReceiverToken(code),
         timer: setTimeout(() => {
            clearPairing();
         }, pairingTtlMs)
      };

      setState({
         pairing
      });

      return {
         ok: true,
         value: pairing
      };
   }

   async function renameDevice(deviceId: string, name: string): Promise<ReceiverActionResult> {
      const parsed = receiverDeviceNameSchema.safeParse(name);
      if (!parsed.success) {
         return errorState('receiver.device-name.invalid', 'Device name is required');
      }

      const snapshot = await options.settingsStore.getSnapshot();
      const devices = snapshot.app.receiver.pairedDevices;

      if (!devices.some((device) => device.id === deviceId)) {
         return errorState('receiver.device.not-found', 'Paired device was not found');
      }

      return writePairedDevices(
         devices.map((device) =>
            device.id === deviceId
               ? {
                    ...device,
                    name: parsed.data
                 }
               : device
         )
      );
   }

   async function revokeDevice(deviceId: string): Promise<ReceiverActionResult> {
      const snapshot = await options.settingsStore.getSnapshot();
      const devices = snapshot.app.receiver.pairedDevices;
      const nextDevices = devices.filter((device) => device.id !== deviceId);

      if (nextDevices.length === devices.length) return okState();

      return writePairedDevices(nextDevices);
   }

   function subscribe(listener: ReceiverListener) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   async function handleRequest(request: IncomingMessage, response: ServerResponse) {
      const route = new URL(request.url ?? '/', `http://${request.headers.host ?? 'receiver.local'}`).pathname;

      if (request.method === 'GET' && route === '/health') {
         writeJson(response, 200, createHealthResponse());
         return;
      }

      if (request.method === 'POST' && route === '/pair/start') {
         await handlePairStart(request, response);
         return;
      }

      if (request.method === 'POST' && route === '/pair/complete') {
         await handlePairComplete(request, response);
         return;
      }

      if (request.method === 'GET' && route === '/capabilities') {
         const device = await authenticate(request, response);
         if (!device) return;

         writeJson(response, 200, createCapabilitiesResponse());
         return;
      }

      if (request.method === 'GET' && route === '/events') {
         const device = await authenticate(request, response);
         if (!device) return;

         attachEventStream(response);
         return;
      }

      writeError(response, {
         status: 404,
         code: 'receiver.route.not-found',
         message: 'Route was not found'
      });
   }

   async function handlePairStart(request: IncomingMessage, response: ServerResponse) {
      const body = await readJsonBody(request);
      if (Result.isError(body)) {
         writeError(response, body.error);
         return;
      }

      const parsed = receiverPairStartRequestSchema.safeParse(body.value);
      if (!parsed.success) {
         writeError(response, {
            status: 400,
            code: 'receiver.pair-start.invalid',
            message: 'Pairing request is invalid'
         });
         return;
      }

      writeJson(response, 200, receiverPairStartResponseSchema.parse(createPairStartResponse()));
   }

   async function handlePairComplete(request: IncomingMessage, response: ServerResponse) {
      const body = await readJsonBody(request);
      if (Result.isError(body)) {
         writeError(response, body.error);
         return;
      }

      const parsed = receiverPairCompleteRequestSchema.safeParse(body.value);
      if (!parsed.success) {
         writeError(response, {
            status: 400,
            code: 'receiver.pair-complete.invalid',
            message: 'Pairing request is invalid'
         });
         return;
      }

      const pairing = pendingPairing;
      if (!pairing || Date.parse(pairing.expiresAt) <= Date.now()) {
         clearPairing();
         writeError(response, {
            status: 403,
            code: 'receiver.pairing.expired',
            message: 'Pairing code is not active'
         });
         return;
      }

      if (!receiverTokenHashesEqual(hashReceiverToken(parsed.data.code), pairing.codeHash)) {
         writeError(response, {
            status: 403,
            code: 'receiver.pairing.invalid',
            message: 'Pairing code is invalid'
         });
         return;
      }

      const token = createReceiverToken();
      const now = new Date().toISOString();
      const device: PairedDevice = {
         id: `device_${Date.now().toString(36)}`,
         name: parsed.data.deviceName,
         tokenHash: hashReceiverToken(token),
         pairedAt: now,
         lastSeenAt: now
      };
      const snapshot = await options.settingsStore.getSnapshot();
      const writeResult = await options.settingsStore.updateAppSettings({
         receiver: {
            pairedDevices: [...snapshot.app.receiver.pairedDevices, device]
         }
      });

      if (!writeResult.ok) {
         writeError(response, {
            status: 500,
            code: writeResult.error.code,
            message: 'Pairing could not be saved'
         });
         return;
      }

      clearPairing();

      writeJson(response, 200, createPairCompleteResponse(token, device));
   }

   async function authenticate(request: IncomingMessage, response: ServerResponse) {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
      if (!token) {
         writeUnauthorized(response);
         return null;
      }

      const tokenHash = hashReceiverToken(token);
      const snapshot = await options.settingsStore.getSnapshot();
      const device = snapshot.app.receiver.pairedDevices.find((candidate) => receiverTokenHashesEqual(tokenHash, candidate.tokenHash));

      if (!device) {
         writeUnauthorized(response);
         return null;
      }

      await markDeviceSeen(device, snapshot);
      return device;
   }

   async function markDeviceSeen(device: PairedDevice, snapshot: SettingsSnapshot) {
      const now = new Date().toISOString();

      await options.settingsStore.updateAppSettings({
         receiver: {
            pairedDevices: snapshot.app.receiver.pairedDevices.map((candidate) =>
               candidate.id === device.id
                  ? {
                       ...candidate,
                       lastSeenAt: now
                    }
                  : candidate
            )
         }
      });
   }

   async function writePairedDevices(pairedDevices: PairedDevice[]): Promise<ReceiverActionResult> {
      const writeResult = await options.settingsStore.updateAppSettings({
         receiver: {
            pairedDevices
         }
      });

      if (!writeResult.ok) {
         return {
            ok: false,
            error: writeResult.error
         };
      }

      return okState();
   }

   function setState(update: Partial<ReceiverState>) {
      state = {
         ...state,
         ...update
      };

      for (const listener of listeners) {
         listener(state);
      }
   }

   function okState(): ReceiverActionResult {
      return {
         ok: true,
         value: state
      };
   }

   function errorState(code: string, message: string): ReceiverActionResult {
      return {
         ok: false,
         error: {
            code,
            message
         }
      };
   }

   function clearPairing() {
      if (pendingPairing) {
         clearTimeout(pendingPairing.timer);
         pendingPairing = null;
      }

      if (state.pairing) {
         setState({
            pairing: null
         });
      }
   }

   function createHealthResponse(): ReceiverHealthResponse {
      return receiverHealthResponseSchema.parse({
         protocolVersion: receiverProtocolVersion,
         name: hostname(),
         status: 'ready'
      });
   }

   function createPairStartResponse() {
      const pairing = pendingPairing
         ? {
              status: 'waiting' as const,
              expiresAt: pendingPairing.expiresAt
           }
         : {
              status: 'not-started' as const
           };

      return {
         protocolVersion: receiverProtocolVersion,
         name: hostname(),
         pairing
      };
   }

   function createTarget(): Target {
      return {
         id: receiverTargetId,
         kind: 'remote',
         name: hostname(),
         status: 'ready',
         capabilities: receiverCapabilities
      };
   }

   function createCapabilitiesResponse(): ReceiverCapabilitiesResponse {
      return receiverCapabilitiesResponseSchema.parse({
         protocolVersion: receiverProtocolVersion,
         target: createTarget()
      });
   }

   function createPairCompleteResponse(token: string, device: PairedDevice): ReceiverPairCompleteResponse {
      return receiverPairCompleteResponseSchema.parse({
         protocolVersion: receiverProtocolVersion,
         token,
         device: {
            id: device.id,
            name: device.name,
            pairedAt: device.pairedAt,
            lastSeenAt: device.lastSeenAt
         },
         target: createTarget()
      });
   }

   function attachEventStream(response: ServerResponse) {
      if (!activeServer) {
         writeError(response, {
            status: 503,
            code: 'receiver.not-running',
            message: 'Receiver is not running'
         });
         return;
      }

      response.writeHead(200, {
         'Content-Type': 'text/event-stream',
         'Cache-Control': 'no-store',
         Connection: 'keep-alive'
      });
      response.write(`event: target\n`);
      response.write(`data: ${JSON.stringify({ type: 'target-updated', target: createTarget() })}\n\n`);

      activeServer.eventResponses.add(response);
      response.on('close', () => {
         activeServer?.eventResponses.delete(response);
      });
   }

   return {
      reconcile,
      start,
      stop,
      getState: () => state,
      startPairing,
      renameDevice,
      revokeDevice,
      subscribe
   };
}

function listenOnLanAddress(
   server: Server,
   address: { host: string; interfaceName: string },
   eventResponses: Set<ServerResponse>,
   sockets: Set<Socket>
) {
   return new Promise<ActiveReceiverServer>((resolve, reject) => {
      server.once('error', reject);
      server.listen(receiverPort, address.host, () => {
         server.removeListener('error', reject);
         resolve({
            server,
            sockets,
            eventResponses,
            addresses: [
               {
                  host: address.host,
                  port: receiverPort,
                  url: `http://${address.host}:${receiverPort}`,
                  interfaceName: address.interfaceName
               }
            ]
         });
      });
   });
}

async function closeServer(activeServer: ActiveReceiverServer) {
   destroyServer(activeServer.server, activeServer.sockets, activeServer.eventResponses);

   await Result.tryPromise({
      try: () =>
         new Promise<void>((resolve) => {
            activeServer.server.close(() => {
               resolve();
            });
         }),
      catch: () => undefined
   });
}

function destroyServer(server: Server, sockets: Set<Socket>, eventResponses: Set<ServerResponse>) {
   for (const response of eventResponses) {
      response.end();
   }
   eventResponses.clear();

   for (const socket of sockets) {
      socket.destroy();
   }
   sockets.clear();

   server.closeAllConnections();
}

async function readJsonBody(request: IncomingMessage) {
   const result = await Result.tryPromise({
      try: async () => {
         const chunks: Buffer[] = [];
         let size = 0;

         for await (const chunk of request) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.byteLength;
            if (size > maxJsonBodyBytes) {
               throw new Error('request body is too large');
            }

            chunks.push(buffer);
         }

         const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
         return value;
      },
      catch: (cause): HttpFailure => ({
         status: 400,
         code: 'receiver.body.invalid',
         message: cause instanceof Error ? cause.message : 'Request body is invalid'
      })
   });

   if (Result.isError(result)) {
      return Result.err(result.error);
   }

   return Result.ok(result.value);
}

function writeUnauthorized(response: ServerResponse) {
   writeError(response, {
      status: 401,
      code: 'receiver.auth.required',
      message: 'Pairing token is required'
   });
}

function writeJson(response: ServerResponse, status: number, body: IpcSerializable | object) {
   response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
   });
   response.end(`${JSON.stringify(body)}\n`);
}

function writeError(response: ServerResponse, failure: HttpFailure) {
   writeJson(response, failure.status, {
      error: {
         code: failure.code,
         message: failure.message
      }
   });
}
