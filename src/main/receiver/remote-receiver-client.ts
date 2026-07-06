import { Result } from 'better-result';
import type { z } from 'zod';

import { isPrivateIpv4Address } from '@/main/receiver/lan';
import type { IpcError } from '@/shared/ipc/core';
import {
   receiverCapabilitiesResponseSchema,
   receiverDeviceNameSchema,
   receiverErrorResponseSchema,
   receiverHealthResponseSchema,
   receiverPairCompleteResponseSchema,
   receiverPairStartResponseSchema
} from '@/shared/receiver';
import type { ReceiverRemoteDisconnectResult, ReceiverRemotePairRequest, ReceiverRemotePairResult } from '@/shared/receiver';
import { targetEventSchema, type InstallSummary, type Target, type TargetEvent, type TargetHealth, type TargetId } from '@/shared/targets';

import { createHash } from 'node:crypto';

const defaultReceiverPort = 38_567;
const requestTimeoutMs = 5_000;

type RemoteReceiverListener = (event: TargetEvent) => void;

type RemoteReceiverSession = {
   target: Target;
   baseUrl: string;
   token: string | null;
   eventAbort?: AbortController;
};

export type RemoteReceiverClient = ReturnType<typeof createRemoteReceiverClient>;

export function createRemoteReceiverClient() {
   const sessions = new Map<TargetId, RemoteReceiverSession>();
   const listeners = new Set<RemoteReceiverListener>();

   async function pair(request: ReceiverRemotePairRequest): Promise<ReceiverRemotePairResult> {
      const deviceName = receiverDeviceNameSchema.safeParse(request.deviceName);
      if (!deviceName.success) {
         return error('receiver.remote.device-name.invalid', 'Device name is required');
      }

      const baseUrlResult = normalizeReceiverBaseUrl(request.host);
      if (Result.isError(baseUrlResult)) {
         return {
            ok: false,
            error: baseUrlResult.error
         };
      }

      const healthResult = await requestJson({
         url: new URL('/health', baseUrlResult.value),
         schema: receiverHealthResponseSchema
      });
      if (Result.isError(healthResult)) {
         return {
            ok: false,
            error: healthResult.error
         };
      }

      const pairStartResult = await requestJson({
         url: new URL('/pair/start', baseUrlResult.value),
         method: 'POST',
         body: {
            deviceName: deviceName.data
         },
         schema: receiverPairStartResponseSchema
      });
      if (Result.isError(pairStartResult)) {
         return {
            ok: false,
            error: pairStartResult.error
         };
      }

      if (pairStartResult.value.pairing.status !== 'waiting') {
         return error('receiver.remote.pairing.not-started', 'Start pairing on the receiver first');
      }

      const pairCompleteResult = await requestJson({
         url: new URL('/pair/complete', baseUrlResult.value),
         method: 'POST',
         body: {
            code: request.pairingCode,
            deviceName: deviceName.data
         },
         schema: receiverPairCompleteResponseSchema
      });
      if (Result.isError(pairCompleteResult)) {
         return {
            ok: false,
            error: pairCompleteResult.error
         };
      }

      const target = createTarget(baseUrlResult.value, pairCompleteResult.value.target);
      const existing = sessions.get(target.id);
      existing?.eventAbort?.abort();

      sessions.set(target.id, {
         target,
         baseUrl: baseUrlResult.value,
         token: pairCompleteResult.value.token
      });
      emit({
         type: 'target-updated',
         target
      });
      connectEvents(target.id);

      return {
         ok: true,
         value: target
      };
   }

   function disconnect(targetId: TargetId): ReceiverRemoteDisconnectResult {
      const session = sessions.get(targetId);
      if (!session) {
         return error('receiver.remote.not-found', 'Remote receiver was not found');
      }

      session.eventAbort?.abort();
      session.token = null;
      session.target = {
         ...session.target,
         status: 'disconnected',
         capabilities: []
      };
      emit({
         type: 'target-updated',
         target: session.target
      });

      return {
         ok: true,
         value: session.target
      };
   }

   function listTargets() {
      return [...sessions.values()].map((session) => session.target);
   }

   function listInstalls(targetId: TargetId): InstallSummary[] {
      const session = sessions.get(targetId);
      if (!session?.target.capabilities.includes('list-installs')) return [];

      return [];
   }

   async function getHealth(targetId: TargetId): Promise<TargetHealth | null> {
      const session = sessions.get(targetId);
      if (!session) return null;

      if (!session.token) {
         return {
            status: 'disconnected',
            capabilities: []
         };
      }

      const capabilitiesResult = await requestJson({
         url: new URL('/capabilities', session.baseUrl),
         token: session.token,
         schema: receiverCapabilitiesResponseSchema
      });

      if (Result.isError(capabilitiesResult)) {
         session.target = {
            ...session.target,
            status: 'disconnected',
            capabilities: []
         };
         emit({
            type: 'target-updated',
            target: session.target
         });

         return {
            status: 'disconnected',
            capabilities: [],
            message: capabilitiesResult.error.message
         };
      }

      session.target = createTarget(session.baseUrl, capabilitiesResult.value.target);
      emit({
         type: 'target-updated',
         target: session.target
      });

      return {
         status: session.target.status,
         capabilities: session.target.capabilities
      };
   }

   function subscribe(listener: RemoteReceiverListener) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   function emit(event: TargetEvent) {
      for (const listener of listeners) {
         listener(event);
      }
   }

   function connectEvents(targetId: TargetId) {
      const session = sessions.get(targetId);
      if (!session?.token) return;

      session.eventAbort?.abort();
      const abort = new AbortController();
      session.eventAbort = abort;

      void Result.tryPromise({
         try: async () => {
            const response = await fetch(new URL('/events', session.baseUrl), {
               headers: {
                  Authorization: `Bearer ${session.token}`
               },
               signal: abort.signal
            });

            if (!response.ok || !response.body) return;

            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = '';

            while (!abort.signal.aborted) {
               const read = await reader.read();
               if (read.done) break;

               buffer += read.value;
               const chunks = buffer.split('\n\n');
               buffer = chunks.pop() ?? '';

               for (const chunk of chunks) {
                  handleEventChunk(session, chunk);
               }
            }
         },
         catch: () => undefined
      });
   }

   function handleEventChunk(session: RemoteReceiverSession, chunk: string) {
      const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) return;

      const payload = Result.try({
         try: (): unknown => JSON.parse(dataLine.slice('data: '.length)),
         catch: (cause) => createIpcError('receiver.remote.event.invalid', 'Receiver event is invalid', cause)
      });
      if (Result.isError(payload)) return;

      const parsed = targetEventSchema.safeParse(payload.value);
      if (!parsed.success) return;

      if (parsed.data.type === 'target-updated') {
         session.target = createTarget(session.baseUrl, parsed.data.target);
         emit({
            type: 'target-updated',
            target: session.target
         });
         return;
      }

      emit(parsed.data);
   }

   return {
      pair,
      disconnect,
      listTargets,
      listInstalls,
      getHealth,
      subscribe
   };
}

function normalizeReceiverBaseUrl(host: string) {
   return Result.try({
      try: () => {
         const trimmed = host.trim();
         const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);

         if (url.protocol !== 'http:') {
            throw new Error('Only HTTP LAN receiver addresses are supported');
         }

         if (!isPrivateIpv4Address(url.hostname)) {
            throw new Error('Receiver address must be a private LAN IPv4 address');
         }

         if (!url.port) {
            url.port = String(defaultReceiverPort);
         }

         url.pathname = '/';
         url.search = '';
         url.hash = '';

         return url.toString();
      },
      catch: (cause) => createIpcError('receiver.remote.host.invalid', 'Receiver address is invalid', cause)
   });
}

async function requestJson<Output>({
   url,
   method = 'GET',
   body,
   token,
   schema
}: {
   url: URL;
   method?: 'GET' | 'POST';
   body?: object;
   token?: string;
   schema: z.ZodType<Output>;
}) {
   const controller = new AbortController();
   const timeout = setTimeout(() => {
      controller.abort();
   }, requestTimeoutMs);

   const result = await Result.tryPromise({
      try: async () => {
         const response = await fetch(url, {
            method,
            headers: {
               Accept: 'application/json',
               ...(body ? { 'Content-Type': 'application/json' } : {}),
               ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
         });
         const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;

         if (!response.ok) {
            const errorResponse = receiverErrorResponseSchema.safeParse(payload);
            throw new Error(errorResponse.success ? errorResponse.data.error.message : `HTTP ${response.status}`);
         }

         return schema.parse(payload);
      },
      catch: (cause) => createIpcError('receiver.remote.request.failed', 'Receiver request failed', cause)
   });

   clearTimeout(timeout);
   return result;
}

function createTarget(baseUrl: string, target: Target): Target {
   return {
      ...target,
      id: `remote_${createHash('sha256').update(baseUrl).digest('hex').slice(0, 12)}`,
      kind: 'remote'
   };
}

function createIpcError(code: string, message: string, cause: unknown): IpcError {
   return {
      code,
      message: cause instanceof Error ? `${message}: ${cause.message}` : `${message}: ${String(cause)}`
   };
}

function error(code: string, message: string) {
   return {
      ok: false,
      error: {
         code,
         message
      }
   } satisfies ReceiverRemotePairResult | ReceiverRemoteDisconnectResult;
}
