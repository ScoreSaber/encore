import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { receiverOperations, type ReceiverOperationDefinition } from '@/modules/receiver/operations';
import {
   negotiateReceiverProtocolVersion,
   receiverErrorResponseSchema,
   receiverProtocolVersion,
   receiverProtocolVersionHeader,
   receiverTargetIdHeader,
   type ReceiverStreamEvent
} from '@/modules/receiver/protocol';

import { createReadStream, createWriteStream } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import { connect as connectTls, rootCertificates, type PeerCertificate } from 'node:tls';

const requestTimeoutMs = 8_000;
const streamIdleTimeoutMs = 45_000;

const minReconnectDelayMs = 1_000;
const maxReconnectDelayMs = 30_000;
const maxResponseBytes = 8 * 1_024 * 1_024;
const maxStreamBufferCharacters = 4 * 1_024 * 1_024;
const uploadTimeoutMs = 5 * 60 * 1_000;
const downloadIdleTimeoutMs = 60_000;

export type ReceiverEndpoint = {
   host: string;
   port: number;
   certificatePem: string;
   fingerprint: string;
};

export type ReceiverTransportFailure = Problem & { kind: 'network' | 'auth' | 'protocol' | 'identity' | 'invalid' | 'missing' };

const missingCodes = new Set(['receiver.route.not-found', 'receiver.target.unsupported']);

function failure(status: number, problem: Problem): ReceiverTransportFailure {
   if (status === 401 || status === 403) return { kind: 'auth', ...problem };
   if (status === 404 && missingCodes.has(problem.code)) return { kind: 'missing', ...problem };
   return { kind: status === 426 ? 'protocol' : 'network', ...problem };
}

export type ReceiverStreamStatus =
   | { type: 'connected' }
   | { type: 'reconnecting'; attempt: number; delayMs: number; message: string }
   | { type: 'auth-lost'; message: string }
   | { type: 'identity-changed'; message: string };

type ReceiverIdentityProbe = {
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
         ...createProblem('receiver.remote.protocol.unsupported', {
            cause: `protocol ${health.value.supportedProtocolVersions.join(', ')} here ${receiverProtocolVersion}`
         })
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
            const socket = connectTls({
               ...address,
               servername: isIP(address.host) ? undefined : address.host,
               rejectUnauthorized: false
            });
            socket.once('secureConnect', () => {
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
      catch: (cause): ReceiverTransportFailure => ({ kind: 'identity', ...createProblem('receiver.remote.identity.unavailable', { cause }) })
   });
}

export async function requestReceiverJson<Schema extends z.ZodType>(input: {
   endpoint: ReceiverEndpoint;
   path: string;
   schema: Schema;
   method?: 'GET' | 'POST';
   body?: object;
   token?: string | null;
   targetId?: string;
}): Promise<Result<z.output<Schema>, ReceiverTransportFailure>> {
   const options = pinnedRequestOptions(
      input.endpoint,
      input.path,
      input.method ?? 'GET',
      input.token,
      Boolean(input.body),
      input.targetId ? { targetId: input.targetId } : undefined
   );
   const response = await sendRequest({ options, body: input.body ? JSON.stringify(input.body) : undefined });
   if (Result.isError(response)) return Result.err(response.error);

   const { status, body } = response.value;
   if (status < 200 || status >= 300) {
      const parsedError = Result.try({
         try: () => receiverErrorResponseSchema.safeParse(body.length > 0 ? JSON.parse(body) : null),
         catch: (cause): ReceiverTransportFailure => ({ kind: 'invalid', ...createProblem('receiver.remote.response.unreadable', { cause }) })
      });
      if (Result.isError(parsedError)) return Result.err(parsedError.error);

      return Result.err(
         failure(
            status,
            parsedError.value.success ? parsedError.value.data.error : createProblem('receiver.remote.request.failed', { cause: `HTTP ${status}` })
         )
      );
   }

   const parsed = Result.try({
      try: () => input.schema.safeParse(body.length > 0 ? JSON.parse(body) : null),
      catch: (cause): ReceiverTransportFailure => ({ kind: 'invalid', ...createProblem('receiver.remote.response.unreadable', { cause }) })
   });
   if (Result.isError(parsed)) return Result.err(parsed.error);
   if (!parsed.value.success) {
      return Result.err({ kind: 'invalid', ...createProblem('receiver.remote.response.invalid') });
   }

   return Result.ok(parsed.value.data);
}

export async function uploadReceiverFile(input: {
   endpoint: ReceiverEndpoint;
   path: string;
   value: object;
   token: string;
   targetId?: string;
   sourcePath: string;
   sizeBytes: number;
   signal?: AbortSignal;
}): Promise<Result<void, ReceiverTransportFailure>> {
   const url = new URL(input.path, 'https://receiver.local');
   url.searchParams.set('input', JSON.stringify(input.value));
   const options = pinnedRequestOptions(input.endpoint, `${url.pathname}${url.search}`, 'POST', input.token, true, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(input.sizeBytes),
      targetId: input.targetId
   });
   const response = await sendRequest({
      options: { ...options, signal: input.signal },
      body: createReadStream(input.sourcePath, { signal: input.signal }),
      timeoutMs: uploadTimeoutMs
   });
   if (Result.isError(response)) return Result.err(response.error);
   const { status, body } = response.value;
   if (status >= 200 && status < 300) return Result.ok(undefined);

   return Result.err(failure(status, receiverError(body) ?? createProblem('receiver.remote.upload.failed', { cause: `HTTP ${status}` })));
}

export async function downloadReceiverFile(input: {
   endpoint: ReceiverEndpoint;
   path: string;
   value: object;
   token: string;
   targetId?: string;
   destinationPath: string;
   signal?: AbortSignal;
}): Promise<Result<{ sizeBytes: number }, ReceiverTransportFailure>> {
   const options = pinnedRequestOptions(input.endpoint, input.path, 'POST', input.token, true, {
      Accept: 'application/octet-stream',
      targetId: input.targetId
   });

   const response = await Result.tryPromise({
      try: () =>
         new Promise<IncomingMessage>((resolve, reject) => {
            const clientRequest = httpsRequest({ ...options, signal: input.signal }, resolve);
            clientRequest.setTimeout(downloadIdleTimeoutMs, () => clientRequest.destroy(new Error('Receiver download stalled')));
            clientRequest.on('error', reject);
            clientRequest.end(JSON.stringify(input.value));
         }),
      catch: (cause): ReceiverTransportFailure => ({ kind: 'network', ...createProblem('receiver.remote.download.failed', { cause }) })
   });
   if (Result.isError(response)) return Result.err(response.error);
   const status = response.value.statusCode ?? 0;

   if (status < 200 || status >= 300) {
      const body = await Result.tryPromise(() => text(response.value));
      return Result.err(
         failure(
            status,
            (Result.isOk(body) && receiverError(body.value)) || createProblem('receiver.remote.download.failed', { cause: `HTTP ${status}` })
         )
      );
   }

   let sizeBytes = 0;
   const written = await Result.tryPromise({
      try: () =>
         pipeline(
            response.value,
            async function* (source: AsyncIterable<Buffer>) {
               for await (const chunk of source) {
                  sizeBytes += chunk.byteLength;
                  yield chunk;
               }
            },
            createWriteStream(input.destinationPath),
            { signal: input.signal }
         ),
      catch: (cause): ReceiverTransportFailure => ({ kind: 'network', ...createProblem('receiver.remote.download.failed', { cause }) })
   });
   return Result.map(written, () => ({ sizeBytes }));
}

type ReceiverOperationCall = {
   endpoint: ReceiverEndpoint;
   operation: ReceiverOperationDefinition;
   token?: string | null;
   body?: object;
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

type StreamLifecycle =
   | { status: 'connecting'; cancel: () => void }
   | { status: 'streaming'; cancel: () => void }
   | { status: 'waiting-reconnect'; timer: ReturnType<typeof setTimeout> }
   | { status: 'closed' };

export function openReceiverEventStream(input: {
   endpoint: ReceiverEndpoint;
   getToken: () => string | null;
   onEvent: (event: ReceiverStreamEvent) => void;
   onStatus: (status: ReceiverStreamStatus) => void;
}): ReceiverEventStream {
   let lifecycle: StreamLifecycle = { status: 'closed' };
   const isClosed = () => lifecycle.status === 'closed';
   let attempt = 0;

   function scheduleReconnect(message: string) {
      if (isClosed()) return;

      attempt += 1;
      const delayMs = Math.min(maxReconnectDelayMs, minReconnectDelayMs * 2 ** (attempt - 1));
      input.onStatus({ type: 'reconnecting', attempt, delayMs, message });
      if (isClosed()) return;

      const timer = setTimeout(connect, delayMs);
      timer.unref();
      lifecycle = { status: 'waiting-reconnect', timer };
   }

   function connect() {
      const token = input.getToken();
      if (!token) {
         lifecycle = { status: 'closed' };
         input.onStatus({ type: 'auth-lost', message: translate('targets.remote.unpaired') });
         return;
      }

      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      let activeResponse: IncomingMessage | null = null;
      let clientRequest: ReturnType<typeof httpsRequest>;

      const clearAttemptTimers = () => {
         if (idleTimer) clearTimeout(idleTimer);
         if (connectTimer) clearTimeout(connectTimer);
         idleTimer = null;
         connectTimer = null;
      };
      const cancelAttempt = () => {
         settled = true;
         clearAttemptTimers();
         activeResponse?.destroy();
         activeResponse = null;
         clientRequest?.destroy();
      };
      const finishStatus = (outcome: ReceiverStreamStatus) => {
         if (settled) return;
         settled = true;
         clearAttemptTimers();
         activeResponse = null;
         if (isClosed()) return;

         lifecycle = { status: 'closed' };
         input.onStatus(outcome);
      };
      const finishFailure = (message: string) => {
         if (settled) return;
         settled = true;
         clearAttemptTimers();
         activeResponse = null;
         if (isClosed()) return;

         scheduleReconnect(message);
      };
      const resetIdleTimer = () => {
         if (idleTimer) clearTimeout(idleTimer);

         idleTimer = setTimeout(() => {
            if (settled || isClosed()) return;

            clientRequest.destroy();
            finishFailure(translate('targets.remote.silent'));
         }, streamIdleTimeoutMs);
         idleTimer.unref();
      };

      clientRequest = httpsRequest(
         pinnedRequestOptions(input.endpoint, receiverOperations.events.path, receiverOperations.events.method, token, false, {
            Accept: 'text/event-stream'
         }),
         (response) => {
            if (settled || isClosed()) {
               response.destroy();
               return;
            }
            if (connectTimer) clearTimeout(connectTimer);
            connectTimer = null;
            activeResponse = response;

            if (response.statusCode === 401 || response.statusCode === 403) {
               response.destroy();
               finishStatus({ type: 'auth-lost', message: translate('targets.remote.rejected') });
               return;
            }

            if (response.statusCode !== 200) {
               response.destroy();
               finishFailure(translate('targets.remote.refused'));
               return;
            }

            attempt = 0;
            lifecycle = { status: 'streaming', cancel: cancelAttempt };
            input.onStatus({ type: 'connected' });
            if (settled || isClosed()) return;

            resetIdleTimer();

            let buffer = '';
            response.setEncoding('utf8');
            response.on('data', (chunk: string) => {
               if (settled || isClosed()) return;

               resetIdleTimer();
               if (chunk.length > maxStreamBufferCharacters - buffer.length) {
                  buffer = '';
                  response.destroy();
                  finishFailure(translate('targets.remote.tooLarge'));
                  return;
               }

               buffer += chunk;

               let boundary = buffer.indexOf('\n\n');
               while (boundary !== -1) {
                  const frame = buffer.slice(0, boundary);
                  buffer = buffer.slice(boundary + 2);
                  const parsed = parseStreamFrame(frame);
                  if (parsed) input.onEvent(parsed);
                  if (settled || isClosed()) return;
                  boundary = buffer.indexOf('\n\n');
               }
            });
            response.on('end', () => finishFailure(translate('targets.remote.closed')));
            response.on('close', () => finishFailure(translate('targets.remote.closed')));
            response.on('error', () => finishFailure(translate('targets.remote.lost')));
         }
      );

      lifecycle = { status: 'connecting', cancel: cancelAttempt };
      clientRequest.on('socket', (socket) => {
         socket.on('close', () => {
            queueMicrotask(() => finishFailure(translate('targets.remote.closed')));
         });
      });
      clientRequest.on('error', (cause) => {
         if (isIdentityFailure(cause)) {
            finishStatus({ type: 'identity-changed', message: translate('targets.remote.identityChanged') });
            return;
         }

         finishFailure(translate('targets.remote.lost'));
      });

      connectTimer = setTimeout(() => {
         clientRequest.destroy();
         finishFailure(translate('targets.remote.noAnswer'));
      }, requestTimeoutMs);
      connectTimer.unref();

      clientRequest.end();
   }

   connect();

   return {
      close() {
         const previous = lifecycle;
         lifecycle = { status: 'closed' };
         if (previous.status === 'waiting-reconnect') {
            clearTimeout(previous.timer);
         } else if (previous.status === 'connecting' || previous.status === 'streaming') {
            previous.cancel();
         }
      }
   };
}

function parseStreamFrame(frame: string) {
   const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
   if (!dataLine) return null;

   const parsed = Result.try(() => receiverOperations.events.response.safeParse(JSON.parse(dataLine.slice('data: '.length))));
   return Result.isOk(parsed) && parsed.value.success ? parsed.value.data : null;
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
            let activeResponse: IncomingMessage | null = null;
            let deadline: ReturnType<typeof setTimeout>;
            const fail = (cause: Error) => {
               if (settled) return;
               settled = true;
               clearTimeout(deadline);
               activeResponse?.destroy();
               if (input.body instanceof Readable && !input.body.destroyed) input.body.destroy();
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
               activeResponse = response;
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
            if (input.body instanceof Readable) {
               input.body.on('error', (cause) => {
                  fail(cause);
                  clientRequest.destroy();
               });
               input.body.pipe(clientRequest);
            } else {
               clientRequest.end(input.body);
            }
         }),
      catch: (cause): ReceiverTransportFailure =>
         isIdentityFailure(cause)
            ? { kind: 'identity', ...createProblem('receiver.remote.identity.changed', { cause }) }
            : { kind: 'network', ...createProblem('receiver.remote.request.failed', { cause }) }
   });
}

type ReceiverRequestHeaders = {
   Accept: string;
   [receiverProtocolVersionHeader]: string;
   'Content-Type'?: string;
   'Content-Length'?: string;
   Authorization?: string;
   [receiverTargetIdHeader]?: string;
};

type RequestHeaderOverrides = {
   Accept?: string;
   'Content-Type'?: string;
   'Content-Length'?: string;
   targetId?: string;
};

function pinnedRequestOptions(
   endpoint: ReceiverEndpoint,
   path: string,
   method: 'GET' | 'POST',
   token: string | null | undefined,
   hasBody: boolean,
   overrides?: RequestHeaderOverrides
) {
   const headers: ReceiverRequestHeaders = {
      Accept: overrides?.Accept ?? 'application/json',
      [receiverProtocolVersionHeader]: String(receiverProtocolVersion)
   };
   const contentType = overrides?.['Content-Type'] ?? (hasBody ? 'application/json' : undefined);
   if (contentType) headers['Content-Type'] = contentType;
   if (overrides?.['Content-Length']) headers['Content-Length'] = overrides['Content-Length'];
   if (token) headers.Authorization = `Bearer ${token}`;
   if (overrides?.targetId) headers[receiverTargetIdHeader] = overrides.targetId;

   return {
      host: endpoint.host,
      servername: isIP(endpoint.host) ? undefined : endpoint.host,
      port: endpoint.port,
      path,
      method,
      agent: false,
      ca: [endpoint.certificatePem, ...rootCertificates],
      checkServerIdentity: (_host: string, peer: PeerCertificate) =>
         peer.fingerprint256 === endpoint.fingerprint ? undefined : new Error('receiver certificate fingerprint does not match'),
      headers
   };
}

function isIdentityFailure(cause: unknown) {
   if (!(cause instanceof Error)) return false;

   const parsed = z.object({ code: z.string() }).safeParse(cause);
   const code = parsed.success ? parsed.data.code : '';
   return cause.message.includes('fingerprint does not match') || code.startsWith('ERR_TLS') || code.includes('CERT');
}

function receiverError(body: string) {
   const decoded = Result.try(() => receiverErrorResponseSchema.safeParse(JSON.parse(body)));
   return Result.isOk(decoded) && decoded.value.success ? decoded.value.data.error : null;
}
