import { Result } from 'better-result';
import type { z } from 'zod';

import { causeFailure } from '@/lib/errors';
import { receiverIpv4AddressSchema } from '@/modules/receiver/main/lan';
import { receiverOperations, type ReceiverOperationDefinition } from '@/modules/receiver/operations';
import {
   negotiateReceiverProtocolVersion,
   receiverErrorResponseSchema,
   receiverProtocolVersion,
   receiverProtocolVersionHeader,
   type ReceiverStreamEvent
} from '@/modules/receiver/protocol';

import { createReadStream } from 'node:fs';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { Readable } from 'node:stream';
import { connect as tlsConnect } from 'node:tls';

export const defaultReceiverPort = 38_567;
export const requestTimeoutMs = 8_000;
export const streamIdleTimeoutMs = 45_000;

const minReconnectDelayMs = 1_000;
const maxReconnectDelayMs = 30_000;
const maxResponseBytes = 4 * 1_024 * 1_024;
const maxStreamBufferCharacters = maxResponseBytes;
const uploadTimeoutMs = 5 * 60 * 1_000;

export type ReceiverEndpoint = {
   host: string;
   port: number;
   certificatePem: string;
   fingerprint: string;
};

export type ReceiverTransportFailure = {
   kind: 'network' | 'auth' | 'protocol' | 'identity' | 'invalid';
   code: string;
   message: string;
   status?: number;
};

export type ReceiverStreamStatus =
   | { type: 'connected' }
   | { type: 'reconnecting'; attempt: number; delayMs: number; message: string }
   | { type: 'auth-lost'; message: string }
   | { type: 'identity-changed'; message: string };

export function parseReceiverHost(host: string) {
   return Result.try({
      try: () => {
         const trimmed = host.trim();
         const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);

         if (url.protocol !== 'https:') throw new Error('Only https receiver addresses are supported');
         if (!receiverIpv4AddressSchema.safeParse(url.hostname).success) {
            throw new Error('Receiver address must be a private LAN or Tailscale IPv4 address');
         }

         return {
            host: url.hostname,
            port: url.port ? Number.parseInt(url.port, 10) : defaultReceiverPort
         };
      },
      catch: (cause): ReceiverTransportFailure => ({
         kind: 'invalid',
         code: 'receiver.remote.host.invalid',
         message: causeFailure('Receiver address is invalid', cause)
      })
   });
}

export type ReceiverIdentityProbe = {
   certificatePem: string;
   fingerprint: string;
   name: string;
   protocolVersion: number;
};

export async function probeReceiverIdentity(address: {
   host: string;
   port: number;
}): Promise<Result<ReceiverIdentityProbe, ReceiverTransportFailure>> {
   const certificate = await readReceiverCertificate(address);
   if (Result.isError(certificate)) return Result.err(certificate.error);

   const health = await requestReceiverOperation({
      endpoint: { ...address, ...certificate.value },
      operation: receiverOperations.health
   });
   if (Result.isError(health)) return Result.err(health.error);

   const negotiated = negotiateReceiverProtocolVersion(health.value.supportedProtocolVersions);
   if (negotiated === null) {
      return Result.err({
         kind: 'protocol',
         code: 'receiver.remote.protocol.unsupported',
         message: `Receiver speaks protocol ${health.value.supportedProtocolVersions.join(', ')} but this app speaks ${receiverProtocolVersion}. Update both devices to the same Encore version`
      });
   }

   return Result.ok({
      ...certificate.value,
      name: health.value.name,
      protocolVersion: negotiated
   });
}

function readReceiverCertificate(address: { host: string; port: number }) {
   return Result.tryPromise({
      try: () =>
         new Promise<{ certificatePem: string; fingerprint: string }>((resolve, reject) => {
            const socket = tlsConnect({ host: address.host, port: address.port, rejectUnauthorized: false }, () => {
               const certificate = socket.getPeerX509Certificate();
               socket.end();

               if (!certificate) {
                  reject(new Error('receiver did not present a certificate'));
                  return;
               }

               resolve({ certificatePem: certificate.toString(), fingerprint: certificate.fingerprint256 });
            });

            socket.setTimeout(requestTimeoutMs, () => {
               socket.destroy(new Error('receiver did not respond'));
            });
            socket.on('error', reject);
         }),
      catch: (cause): ReceiverTransportFailure => ({
         kind: 'identity',
         code: 'receiver.remote.identity.unavailable',
         message: causeFailure('Receiver identity could not be read', cause)
      })
   });
}

export async function requestReceiverJson<Schema extends z.ZodType>(input: {
   endpoint: ReceiverEndpoint;
   path: string;
   schema: Schema;
   method?: 'GET' | 'POST';
   body?: unknown;
   token?: string | null;
}): Promise<Result<z.output<Schema>, ReceiverTransportFailure>> {
   const response = await sendRequest({
      options: pinnedRequestOptions(input.endpoint, input.path, input.method ?? 'GET', input.token, Boolean(input.body)),
      body: input.body ? JSON.stringify(input.body) : undefined
   });
   if (Result.isError(response)) return Result.err(response.error);

   const decoded = Result.try({
      try: (): unknown => (response.value.body.length > 0 ? JSON.parse(response.value.body) : null),
      catch: (cause): ReceiverTransportFailure => ({
         kind: 'invalid',
         code: 'receiver.remote.response.invalid',
         message: causeFailure('Receiver response is not valid JSON', cause)
      })
   });
   if (Result.isError(decoded)) return Result.err(decoded.error);

   if (response.value.status < 200 || response.value.status >= 300) {
      const failure = receiverErrorResponseSchema.safeParse(decoded.value);
      const message = failure.success ? failure.data.error.message : `Receiver request failed (HTTP ${response.value.status})`;

      return Result.err({
         kind: response.value.status === 401 || response.value.status === 403 ? 'auth' : response.value.status === 426 ? 'protocol' : 'network',
         code: failure.success ? failure.data.error.code : 'receiver.remote.request.failed',
         message,
         status: response.value.status
      });
   }

   const parsed = input.schema.safeParse(decoded.value);
   if (!parsed.success) {
      return Result.err({
         kind: 'invalid',
         code: 'receiver.remote.response.invalid',
         message: 'Receiver response did not match the expected shape'
      });
   }

   return Result.ok(parsed.data);
}

export async function uploadReceiverFile(input: {
   endpoint: ReceiverEndpoint;
   path: string;
   value: object;
   token: string;
   sourcePath: string;
   sizeBytes: number;
}): Promise<Result<void, ReceiverTransportFailure>> {
   const url = new URL(input.path, 'https://receiver.local');
   url.searchParams.set('input', JSON.stringify(input.value));
   const options = pinnedRequestOptions(input.endpoint, `${url.pathname}${url.search}`, 'POST', input.token, true);
   options.headers = {
      ...options.headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(input.sizeBytes)
   };
   const response = await sendRequest({ options, body: createReadStream(input.sourcePath), timeoutMs: uploadTimeoutMs });
   if (Result.isError(response)) return Result.err(response.error);
   if (response.value.status >= 200 && response.value.status < 300) return Result.ok(undefined);

   const decoded = Result.try({
      try: () => receiverErrorResponseSchema.safeParse(JSON.parse(response.value.body)),
      catch: () => null
   });
   const failure = Result.isOk(decoded) ? decoded.value : null;

   return Result.err({
      kind: response.value.status === 401 || response.value.status === 403 ? 'auth' : 'network',
      code: failure?.success ? failure.data.error.code : 'receiver.remote.upload.failed',
      message: failure?.success ? failure.data.error.message : `Receiver upload failed (HTTP ${response.value.status})`,
      status: response.value.status
   });
}

type ReceiverOperationCall = {
   endpoint: ReceiverEndpoint;
   operation: ReceiverOperationDefinition;
   token?: string | null;
   body?: unknown;
};

export function requestReceiverOperation<ResponseSchema extends z.ZodType<object>>(input: {
   endpoint: ReceiverEndpoint;
   operation: ReceiverOperationDefinition & { request?: undefined; response: ResponseSchema };
   token?: string | null;
}): Promise<Result<z.output<ResponseSchema>, ReceiverTransportFailure>>;
export function requestReceiverOperation<RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType<object>>(input: {
   endpoint: ReceiverEndpoint;
   operation: ReceiverOperationDefinition & { request: RequestSchema; response: ResponseSchema };
   token?: string | null;
   body: z.input<RequestSchema>;
}): Promise<Result<z.output<ResponseSchema>, ReceiverTransportFailure>>;
export function requestReceiverOperation(input: ReceiverOperationCall) {
   return requestReceiverJson({
      endpoint: input.endpoint,
      path: input.operation.path,
      method: input.operation.method,
      schema: input.operation.response,
      token: input.token,
      body: input.body
   });
}

export type ReceiverEventStream = {
   close: () => void;
};

export function openReceiverEventStream(input: {
   endpoint: ReceiverEndpoint;
   getToken: () => string | null;
   onEvent: (event: ReceiverStreamEvent) => void;
   onStatus: (status: ReceiverStreamStatus) => void;
   idleTimeoutMs?: number;
}): ReceiverEventStream {
   const idleTimeoutMs = input.idleTimeoutMs ?? streamIdleTimeoutMs;
   let closed = false;
   let attempt = 0;
   let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
   let active: ReturnType<typeof httpsRequest> | null = null;

   function clearReconnectTimer() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
   }

   function scheduleReconnect(message: string) {
      if (closed) return;

      attempt += 1;
      const delayMs = Math.min(maxReconnectDelayMs, minReconnectDelayMs * 2 ** (attempt - 1));
      input.onStatus({ type: 'reconnecting', attempt, delayMs, message });

      reconnectTimer = setTimeout(connect, delayMs);
      reconnectTimer.unref();
   }

   function connect() {
      if (closed) return;
      reconnectTimer = null;

      const token = input.getToken();
      if (!token) {
         input.onStatus({ type: 'auth-lost', message: 'Pairing token is unavailable' });
         return;
      }

      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      let clientRequest: ReturnType<typeof httpsRequest>;
      const clearAttemptTimers = () => {
         if (idleTimer) clearTimeout(idleTimer);
         if (connectTimer) clearTimeout(connectTimer);
         idleTimer = null;
         connectTimer = null;
      };
      const finish = (outcome: ReceiverStreamStatus | string) => {
         if (settled) return;
         settled = true;
         clearAttemptTimers();
         if (active === clientRequest) active = null;
         if (closed) return;

         if (typeof outcome === 'string') scheduleReconnect(outcome);
         else input.onStatus(outcome);
      };
      const resetIdleTimer = () => {
         if (idleTimer) clearTimeout(idleTimer);

         idleTimer = setTimeout(() => {
            if (active !== clientRequest) return;

            clientRequest.destroy();
            finish('Receiver stopped sending heartbeats');
         }, idleTimeoutMs);
         idleTimer.unref();
      };

      clientRequest = httpsRequest(
         {
            ...pinnedRequestOptions(input.endpoint, receiverOperations.events.path, receiverOperations.events.method, token, false),
            headers: {
               ...baseHeaders(),
               Accept: 'text/event-stream',
               Authorization: `Bearer ${token}`
            }
         },
         (response) => {
            if (connectTimer) clearTimeout(connectTimer);
            connectTimer = null;

            if (response.statusCode === 401 || response.statusCode === 403) {
               response.destroy();
               finish({ type: 'auth-lost', message: 'Receiver rejected the pairing token' });
               return;
            }

            if (response.statusCode !== 200) {
               response.destroy();
               finish(`Receiver event stream failed (HTTP ${response.statusCode ?? 0})`);
               return;
            }

            attempt = 0;
            input.onStatus({ type: 'connected' });
            resetIdleTimer();

            let buffer = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => {
               if (settled) return;

               resetIdleTimer();
               if (chunk.length > maxStreamBufferCharacters - buffer.length) {
                  buffer = '';
                  response.destroy();
                  finish('Receiver event stream frame is too large');
                  return;
               }

               buffer += chunk;

               let boundary = buffer.indexOf('\n\n');
               while (boundary !== -1) {
                  const frame = buffer.slice(0, boundary);
                  buffer = buffer.slice(boundary + 2);
                  const parsed = parseStreamFrame(frame);
                  if (parsed) input.onEvent(parsed);
                  boundary = buffer.indexOf('\n\n');
               }
            });
            response.on('end', () => finish('Receiver closed the event stream'));
            response.on('close', () => finish('Receiver closed the event stream'));
            response.on('error', (cause) => finish(causeFailure('Receiver event stream failed', cause)));
         }
      );

      active = clientRequest;
      clientRequest.on('socket', (socket) => {
         socket.on('close', () => finish('Receiver closed the event stream'));
      });
      clientRequest.on('error', (cause) => {
         if (isIdentityFailure(cause)) {
            finish({ type: 'identity-changed', message: causeFailure('Receiver identity changed', cause) });
            return;
         }

         finish(causeFailure('Receiver event stream failed', cause));
      });

      connectTimer = setTimeout(() => {
         clientRequest.destroy();
         finish('Receiver did not answer the event stream');
      }, requestTimeoutMs);
      connectTimer.unref();

      clientRequest.end();
   }

   connect();

   return {
      close() {
         closed = true;
         clearReconnectTimer();
         active?.destroy();
         active = null;
      }
   };
}

function parseStreamFrame(frame: string) {
   const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
   if (!dataLine) return null;

   const decoded = Result.try({
      try: (): unknown => JSON.parse(dataLine.slice('data: '.length)),
      catch: () => null
   });
   if (Result.isError(decoded)) return null;

   const parsed = receiverOperations.events.response.safeParse(decoded.value);
   return parsed.success ? parsed.data : null;
}

type RawResponse = {
   status: number;
   body: string;
};

async function sendRequest(input: { options: RequestOptions; body?: string | Readable; timeoutMs?: number }) {
   return Result.tryPromise({
      try: () =>
         new Promise<RawResponse>((resolve, reject) => {
            let settled = false;
            let responseStarted = false;
            let deadline: ReturnType<typeof setTimeout>;
            const fail = (cause: Error) => {
               if (settled) return;
               settled = true;
               clearTimeout(deadline);
               reject(cause);
            };
            const succeed = (response: RawResponse) => {
               if (settled) return;
               settled = true;
               clearTimeout(deadline);
               resolve(response);
            };
            const clientRequest = httpsRequest(input.options, (response) => {
               responseStarted = true;
               const chunks: Buffer[] = [];
               let size = 0;
               let ended = false;

               response.on('data', (chunk: Buffer) => {
                  if (settled) return;

                  size += chunk.byteLength;
                  if (size > maxResponseBytes) {
                     fail(new Error('Receiver response is too large'));
                     response.destroy();
                     return;
                  }

                  chunks.push(chunk);
               });
               response.on('end', () => {
                  ended = true;
                  succeed({
                     status: response.statusCode ?? 0,
                     body: Buffer.concat(chunks).toString('utf8')
                  });
               });
               response.on('aborted', () => fail(new Error('Receiver response was aborted')));
               response.on('error', (cause) => fail(cause));
               response.on('close', () => {
                  if (!ended) fail(new Error('Receiver response closed before it completed'));
               });
            });

            deadline = setTimeout(() => {
               fail(new Error('Receiver request timed out'));
               clientRequest.destroy();
            }, input.timeoutMs ?? requestTimeoutMs);
            deadline.unref();
            clientRequest.on('error', fail);
            clientRequest.on('close', () => {
               if (!responseStarted) fail(new Error('Receiver request closed before a response arrived'));
            });
            if (typeof input.body === 'string' || input.body === undefined) {
               clientRequest.end(input.body);
            } else {
               input.body.on('error', (cause) => {
                  fail(cause);
                  clientRequest.destroy();
               });
               input.body.pipe(clientRequest);
            }
         }),
      catch: (cause): ReceiverTransportFailure =>
         isIdentityFailure(cause)
            ? {
                 kind: 'identity',
                 code: 'receiver.remote.identity.changed',
                 message: causeFailure('Receiver identity does not match the pinned certificate', cause)
              }
            : {
                 kind: 'network',
                 code: 'receiver.remote.request.failed',
                 message: causeFailure('Receiver request failed', cause)
              }
   });
}

function pinnedRequestOptions(
   endpoint: ReceiverEndpoint,
   path: string,
   method: 'GET' | 'POST',
   token: string | null | undefined,
   hasBody: boolean
): RequestOptions {
   return {
      host: endpoint.host,
      port: endpoint.port,
      path,
      method,
      agent: false,
      ca: [endpoint.certificatePem],
      checkServerIdentity: (_host, peer) =>
         peer.fingerprint256 === endpoint.fingerprint ? undefined : new Error('receiver certificate fingerprint does not match'),
      headers: {
         ...baseHeaders(),
         ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
         ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
   };
}

function baseHeaders() {
   return {
      Accept: 'application/json',
      [receiverProtocolVersionHeader]: String(receiverProtocolVersion)
   };
}

function isIdentityFailure(cause: unknown) {
   if (!(cause instanceof Error)) return false;

   const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
   return cause.message.includes('fingerprint does not match') || code.startsWith('ERR_TLS') || code.includes('CERT');
}
