import { Adb, AdbDaemonTransport, AdbPacket, AdbPacketSerializeStream, type AdbCredentialStore, type AdbPrivateKey } from '@yume-chan/adb';
import { ConcatStringStream, Consumable, ReadableStream, StructDeserializeStream, TextDecoderStream } from '@yume-chan/stream-extra';
import { Result } from 'better-result';

import { createAdbClient, type AdbExec } from '@/lib/android/adb';
import { authenticateAdbTls, createAdbCertificate, startAdbTls } from '@/lib/android/adb-tls';
import { abortedBy } from '@/lib/async';
import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { writeFileAtomic } from '@/lib/filesystem/atomic-write';

import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TLSSocket } from 'node:tls';

type AndroidAdbEndpoint = { host: string; port: number };
export type AdbPairingIdentity = { code: string; key: string; certificate: string };

type ConnectionState =
   | { status: 'disabled' }
   | { status: 'disconnected' }
   | { status: 'connecting'; generation: number; controller: AbortController; promise: Promise<Result<Adb, Problem>> }
   | { status: 'connected'; generation: number; adb: Adb };

export function createAndroidAdb(options: {
   keyPath: string;
   endpoint?: AndroidAdbEndpoint;
   findWirelessDebuggingPort?: () => Promise<Result<number, Problem>>;
   pairWirelessDebugging?: (input: AdbPairingIdentity) => Promise<Result<void, Problem>>;
}) {
   let endpoint = options.endpoint ? { ...options.endpoint } : { host: '127.0.0.1', port: 5555 };
   let state: ConnectionState = { status: 'disconnected' };
   let generation = 0;
   let tlsPort: number | null = null;
   const credentials = createAndroidAdbCredentialStore(options.keyPath);

   function serial() {
      return endpoint.host.includes(':') ? `[${endpoint.host}]:${endpoint.port}` : `${endpoint.host}:${endpoint.port}`;
   }

   function connect(): Promise<Result<Adb, Problem>> {
      if (state.status === 'disabled') {
         return Promise.resolve(Result.err<Adb, Problem>(createProblem('android.adb.disconnected')));
      }
      if (state.status === 'connected') return Promise.resolve(Result.ok<Adb, Problem>(state.adb));
      if (state.status === 'connecting') return state.promise;

      const openingGeneration = generation;
      const controller = new AbortController();
      const promise = open(openingGeneration, controller.signal).finally(() => {
         if (state.status === 'connecting' && state.promise === promise) {
            state = { status: 'disconnected' };
         }
      });
      state = { status: 'connecting', generation: openingGeneration, controller, promise };
      return promise;
   }

   async function dial(target: AndroidAdbEndpoint, attempt: Socket[], deadline: AbortSignal) {
      if (deadline.aborted) return Result.err<Socket>(timedOut());
      const socket = new Socket();
      attempt.push(socket);
      return Result.tryPromise({
         try: () =>
            new Promise<Socket>((resolve, reject) => {
               socket.once('error', reject);
               socket.connect(target, () => resolve(socket));
            }),
         catch: (cause) => cause
      });
   }

   async function dialTls(target: AndroidAdbEndpoint, attempt: Socket[], deadline: AbortSignal) {
      const socket = await dial(target, attempt, deadline);
      if (Result.isError(socket)) return socket.mapError(connectionFailed);
      const secured = await Result.tryPromise({
         try: async (): Promise<Socket> => {
            const { buffer } = await credentials.generateKey();
            const tlsSocket = await startAdbTls(socket.value, buffer);
            attempt.push(tlsSocket);
            return tlsSocket;
         },
         catch: connectionFailed
      });
      if (Result.isError(secured)) socket.value.destroy();
      return secured;
   }

   async function dialDevice(target: AndroidAdbEndpoint, attempt: Socket[], deadline: AbortSignal) {
      const direct = await dial(target, attempt, deadline);
      const findPort = options.findWirelessDebuggingPort;
      if (Result.isOk(direct) || causeCode(direct.error) !== 'ECONNREFUSED' || target.host !== '127.0.0.1' || !findPort) {
         return direct.mapError(connectionFailed);
      }
      if (tlsPort !== null) {
         const remembered = await dialTls({ host: target.host, port: tlsPort }, attempt, deadline);
         if (Result.isOk(remembered)) return remembered;
         tlsPort = null;
      }
      return Result.gen(async function* () {
         const cancelled = abortedBy(deadline, () => connectionFailed(timedOut()));
         const port = yield* Result.await(Promise.race([findPort(), cancelled.result]).finally(cancelled.release));
         if (deadline.aborted) return Result.err(connectionFailed(timedOut()));
         const socket = yield* Result.await(dialTls({ host: target.host, port }, attempt, deadline));
         tlsPort = port;
         return Result.ok(socket);
      });
   }

   async function open(openingGeneration: number, cancelSignal: AbortSignal): Promise<Result<Adb, Problem>> {
      const openingSerial = serial();
      const attempt: Socket[] = [];
      const deadline = AbortSignal.any([cancelSignal, AbortSignal.timeout(30_000)]);
      const abandon = () => {
         const reason = cancelSignal.aborted ? new Error('ADB connection was closed') : timedOut();
         for (const socket of attempt) socket.destroy(reason);
      };
      deadline.addEventListener('abort', abandon, { once: true });
      const dialed = await dialDevice(endpoint, attempt, deadline);
      const opened = await dialed.andThenAsync((socket) => Result.tryPromise({ try: () => openAdb(socket, openingSerial), catch: connectionFailed }));
      deadline.removeEventListener('abort', abandon);
      if (Result.isError(opened)) {
         for (const socket of attempt) socket.destroy();
         return Result.err(opened.error);
      }
      const { adb, socket } = opened.value;
      if (openingGeneration !== generation || cancelSignal.aborted) {
         await Result.tryPromise(() => adb.close());
         socket.destroy();
         return Result.err<Adb, Problem>(createProblem('android.adb.connection-cancelled'));
      }
      state = { status: 'connected', generation: openingGeneration, adb };
      void Result.tryPromise(() => adb.disconnected).then(() => {
         if (state.status === 'connected' && state.adb === adb) state = { status: 'disconnected' };
         socket.destroy();
      });
      return Result.ok<Adb, Problem>(adb);
   }

   async function openAdb(socket: Socket, openingSerial: string) {
      socket.setNoDelay(true);
      const outgoing = new AdbPacketSerializeStream();
      void Result.tryPromise({
         try: () =>
            outgoing.readable.pipeTo(
               new Consumable.WritableStream<Uint8Array>({
                  write: (chunk) =>
                     new Promise<void>((resolve, reject) => {
                        socket.write(chunk, (error) => (error ? reject(error) : resolve()));
                     }),
                  close: () => {
                     socket.destroy();
                  },
                  abort: () => {
                     socket.destroy();
                  }
               })
            ),
         catch: (cause) => {
            socket.destroy();
            return cause;
         }
      });
      const connection = {
         readable: nodeReadable(socket).pipeThrough(new StructDeserializeStream(AdbPacket)),
         writable: outgoing.writable
      };
      const transport =
         socket instanceof TLSSocket
            ? await authenticateAdbTls(openingSerial, connection)
            : await AdbDaemonTransport.authenticate({ serial: openingSerial, credentialStore: credentials, connection });
      return { adb: new Adb(transport), socket };
   }

   const exec: AdbExec = async ({ args, timeoutMs }) => {
      if (args[0] === 'disconnect') {
         if (args[1] && args[1] !== serial()) return Result.err(createProblem('android.adb.endpoint-changed'));
         await teardown('disabled');
         return Result.ok({ stdout: `disconnected ${args[1] ?? serial()}`, stderr: '' });
      }
      let requestedSerial = args[0] === '-s' ? (args[1] ?? '') : null;
      if (args[0] === 'connect' && args[1]) {
         const address = new URL(`tcp://${args[1]}`);
         await setEndpoint({ host: address.hostname.replace(/^\[|\]$/g, ''), port: Number(address.port) });
         requestedSerial = serial();
      }
      const connectionSerial = serial();
      const connectionGeneration = generation;
      if (requestedSerial !== null && requestedSerial !== connectionSerial) return Result.err(createProblem('android.adb.endpoint-changed'));
      const connection = await connect();
      if (Result.isError(connection)) return Result.err(connection.error);
      if (generation !== connectionGeneration || connection.value.serial !== connectionSerial) {
         return Result.err(createProblem('android.adb.endpoint-changed'));
      }
      if (args[0] === 'connect') return Result.ok({ stdout: `connected to ${connectionSerial}`, stderr: '' });
      const adb = connection.value;
      const command = args[0] === '-s' ? args.slice(2) : args;
      const deadline = new AbortController();
      let wedged: ReturnType<typeof setTimeout> | undefined;
      const timeout = setTimeout(() => {
         deadline.abort(new Error('The device command timed out'));
         wedged = setTimeout(() => void Result.tryPromise(() => adb.close()), 5_000);
      }, timeoutMs);
      const executed = await Result.tryPromise({
         try: async () => {
            if (args[0] === 'devices') {
               const tokens = [`product:${adb.banner.product ?? ''}`, `model:${adb.banner.model ?? ''}`].filter((token) => !token.endsWith(':'));
               return Result.ok({ stdout: `List of devices attached\n${[connectionSerial, 'device', ...tokens].join('\t')}\n`, stderr: '' });
            }
            if (command[0] === 'tcpip' && command[1]) {
               return Result.ok({ stdout: await adb.tcpip.setPort(Number(command[1])), stderr: '' });
            }
            if (command[0] === 'shell') {
               const shellProtocol = adb.subprocess.shellProtocol;
               if (shellProtocol) {
                  const process = await shellProtocol.spawn([command[1] ?? ''], deadline.signal);
                  const [stdout, stderr, exitCode] = await Promise.all([readText(process.stdout), readText(process.stderr), process.exited]);
                  if (exitCode !== 0) {
                     return Result.err<{ stdout: string; stderr: string }, Problem>(
                        createProblem('android.adb.shell-failed', { cause: `exit ${exitCode}: ${stderr.trim() || stdout.trim()}` })
                     );
                  }
                  return Result.ok({ stdout, stderr });
               }
               const process = await adb.subprocess.noneProtocol.spawn([command[1] ?? ''], deadline.signal);
               const [stdout] = await Promise.all([readText(process.output), process.exited]);
               return Result.ok({ stdout, stderr: '' });
            }
            if ((command[0] === 'push' || command[0] === 'pull') && command[1] && command[2]) {
               const [direction, source, destination] = command;
               if (direction === 'pull') await mkdir(dirname(destination), { recursive: true });
               const sync = await adb.sync();
               const cancel = () => void sync.dispose();
               deadline.signal.addEventListener('abort', cancel, { once: true });
               const transferred = await Result.tryPromise({
                  try: () =>
                     direction === 'push'
                        ? sync.write({ filename: destination, file: nodeReadable(createReadStream(source)) })
                        : pipeline(sync.read(source).values(), createWriteStream(destination)),
                  catch: (cause) => cause
               });
               deadline.signal.removeEventListener('abort', cancel);
               await sync.dispose();
               return transferred.map(() => ({ stdout: '', stderr: '' })).mapError(adbFailure);
            }
            return Result.err<{ stdout: string; stderr: string }, Problem>(createProblem('android.adb.unsupported-command'));
         },
         catch: adbFailure
      });
      clearTimeout(timeout);
      clearTimeout(wedged);
      return Result.flatten(executed);
   };

   async function teardown(nextStatus: 'disabled' | 'disconnected') {
      generation += 1;
      tlsPort = null;
      const previous = state;
      state = { status: nextStatus };

      if (previous.status === 'connecting') {
         previous.controller.abort();
         await previous.promise;
      } else if (previous.status === 'connected') {
         await Result.tryPromise(() => previous.adb.close());
      }
   }

   async function dispose() {
      await teardown('disconnected');
   }

   async function setEndpoint(next: AndroidAdbEndpoint) {
      await teardown('disabled');
      endpoint = { ...next };
      state = { status: 'disconnected' };
   }

   function pairLocal(code: string) {
      const pair = options.pairWirelessDebugging;
      if (!pair) return Promise.resolve(Result.err(createProblem('mobile.native-unavailable')));
      return Result.gen(async function* () {
         const identity = yield* Result.await(
            Result.tryPromise({
               try: async () => {
                  const { buffer } = await credentials.generateKey();
                  const key = Buffer.from(buffer);
                  const certificate = createAdbCertificate(createPrivateKey({ key, format: 'der', type: 'pkcs8' }));
                  return { key: key.toString('base64'), certificate: certificate.raw.toString('base64') };
               },
               catch: connectionFailed
            })
         );
         return pair({ code, ...identity });
      });
   }

   return { client: createAdbClient({ adbPath: 'android', exec, installViaShell: true }), pairLocal, dispose };
}

function connectionFailed(cause: unknown) {
   return createProblem('android.adb.connection-failed', { cause });
}

function adbFailure(cause: unknown) {
   return createProblem('android.adb.failed', { cause });
}

function timedOut() {
   return new Error('ADB connection timed out');
}

function readText(stream: ReadableStream<Uint8Array>) {
   return stream.pipeThrough(new TextDecoderStream()).pipeThrough(new ConcatStringStream());
}

function nodeReadable(source: Readable) {
   source.pause();
   return ReadableStream.from(
      (async function* () {
         for await (const chunk of source) {
            if (chunk instanceof Uint8Array) yield chunk;
         }
      })()
   );
}

function createAndroidAdbCredentialStore(keyPath: string): AdbCredentialStore {
   let loading: Promise<AdbPrivateKey> | undefined;

   function getOrCreateKey() {
      loading ??= readOrCreateKey().finally(() => {
         loading = undefined;
      });
      return loading;
   }

   async function readOrCreateKey(): Promise<AdbPrivateKey> {
      const stored = await Result.tryPromise({ try: () => readFile(keyPath), catch: (cause) => cause });
      if (Result.isOk(stored)) return { buffer: stored.value, name: 'Encore' };
      if (causeCode(stored.error) !== 'ENOENT') throw stored.error;

      const key = generateKeyPairSync('rsa', {
         modulusLength: 2048,
         publicExponent: 65537,
         privateKeyEncoding: { type: 'pkcs8', format: 'der' },
         publicKeyEncoding: { type: 'spki', format: 'der' }
      });
      const written = await writeFileAtomic(keyPath, key.privateKey, { dirMode: 0o700, fileMode: 0o600 });
      if (Result.isError(written)) throw new Error(written.error.detail ?? written.error.message);
      return { buffer: key.privateKey, name: 'Encore' };
   }

   async function* iterateKeys() {
      const stored = await Result.tryPromise({ try: () => readFile(keyPath), catch: (cause) => cause });
      if (Result.isError(stored)) {
         if (causeCode(stored.error) !== 'ENOENT') throw stored.error;
         return;
      }
      yield { buffer: stored.value, name: 'Encore' };
   }

   return { generateKey: getOrCreateKey, iterateKeys };
}
