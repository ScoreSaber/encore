import { Result } from 'better-result';
import nacl from 'tweetnacl';

import { createProblem, type Problem } from '@/lib/errors';
import type { QuestPairingRequest } from '@/modules/quest/contract';

const fragmentBytes = 20;
const lastFragment = 0x8000;
const maxMessageBytes = 128 * 1024;
const nonceBytes = nacl.box.nonceLength;
const exchangeTimeoutMs = 15_000;
const pairingTimeoutMs = 90_000;
const idleReadMs = 200;
const method = { hello: 1, authenticate: 2, enableDeveloperMode: 6001, developerModeStatus: 6002, startPairing: 6018, pairingStatus: 6019 };

export type CompanionTransport = {
   write: (chunk: Uint8Array) => Promise<void>;
   read: () => Promise<Uint8Array>;
};

export type CompanionPhase = 'handshake' | 'authenticate' | 'developer-mode' | 'pairing';

type CompanionSetup = {
   transport: CompanionTransport;
   prove: (challenge: Uint8Array) => Promise<Result<Uint8Array, Problem>>;
   onPhase: (phase: CompanionPhase) => void;
   signal: AbortSignal;
};

type Field = { kind: 'varint'; value: number } | { kind: 'bytes'; value: Uint8Array<ArrayBuffer> };
type Fields = Map<number, Field>;
type Session = { encrypt: (plain: Uint8Array) => Uint8Array; decrypt: (packet: Uint8Array) => Result<Uint8Array, Problem> };
type Reply = { ok: true; body: Uint8Array<ArrayBuffer> } | { ok: false; code: number; codeV2: number | null };
type Pairing = Partial<QuestPairingRequest>;

function varint(value: number) {
   const bytes: number[] = [];
   let rest = value;
   do {
      const low = rest % 128;
      rest = Math.floor(rest / 128);
      bytes.push(rest ? low | 128 : low);
   } while (rest);
   return bytes;
}

function varintField(field: number, value: number) {
   return [field * 8, ...varint(value)];
}

function bytesField(field: number, bytes: Uint8Array) {
   return [field * 8 + 2, ...varint(bytes.length), ...bytes];
}

function encodeRequest(methodId: number, sequence: number, body?: Uint8Array) {
   return Uint8Array.from([...varintField(1, 1), ...varintField(2, methodId), ...varintField(3, sequence), ...(body ? bytesField(4, body) : [])]);
}

function readFields(bytes: Uint8Array): Result<Fields, Problem> {
   const malformed = Result.err(createProblem('quest.companion.malformed'));
   const fields: Fields = new Map();
   let offset = 0;
   const readVarint = () => {
      let value = 0;
      for (let shift = 0; shift < 63; shift += 7) {
         const byte = bytes[offset];
         if (byte === undefined) return null;
         offset += 1;
         value += (byte & 127) * 2 ** shift;
         if (!(byte & 128)) return value;
      }
      return null;
   };

   while (offset < bytes.length) {
      const tag = readVarint();
      if (tag === null) return malformed;
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (wire === 0) {
         const value = readVarint();
         if (value === null) return malformed;
         fields.set(field, { kind: 'varint', value });
      } else if (wire === 2) {
         const length = readVarint();
         if (length === null || offset + length > bytes.length) return malformed;
         fields.set(field, { kind: 'bytes', value: bytes.slice(offset, offset + length) });
         offset += length;
      } else if (wire === 1 || wire === 5) {
         offset += wire === 1 ? 8 : 4;
         if (offset > bytes.length) return malformed;
      } else {
         return malformed;
      }
   }
   return Result.ok(fields);
}

function varintOf(fields: Fields, field: number) {
   const found = fields.get(field);
   return found?.kind === 'varint' ? found.value : undefined;
}

function bytesOf(fields: Fields, field: number) {
   const found = fields.get(field);
   return found?.kind === 'bytes' ? found.value : undefined;
}

function fragment(message: Uint8Array) {
   const payloadBytes = fragmentBytes - 2;
   const count = Math.ceil(message.length / payloadBytes);
   return Array.from({ length: count }, (_, index) => {
      const header = index | (index === count - 1 ? lastFragment : 0);
      return Uint8Array.from([header >> 8, header & 255, ...message.subarray(index * payloadBytes, (index + 1) * payloadBytes)]);
   });
}

function isIdle(chunk: Uint8Array) {
   return chunk.length === 0 || (chunk.length === 1 && chunk[0] === 0xff) || (chunk.length === 4 && chunk.every((byte) => byte === 0x2d));
}

export function waitAbortable(ms: number, signal: AbortSignal) {
   if (signal.aborted) return Promise.resolve();
   return new Promise<void>((resolve) => {
      const finish = () => {
         clearTimeout(timer);
         signal.removeEventListener('abort', finish);
         resolve();
      };
      const timer = setTimeout(finish, ms);
      signal.addEventListener('abort', finish, { once: true });
   });
}

function exchange(transport: CompanionTransport, message: Uint8Array, signal: AbortSignal) {
   return Result.gen(async function* () {
      const deadline = Date.now() + exchangeTimeoutMs;
      for (const chunk of fragment(message)) {
         if (signal.aborted) return Result.err(createProblem('quest.companion.cancelled'));
         yield* Result.await(
            Result.tryPromise({
               try: () => transport.write(chunk),
               catch: () => createProblem('quest.companion.write-failed')
            })
         );
      }

      const parts: number[] = [];
      let next = 0;
      while (Date.now() < deadline && !signal.aborted) {
         const chunk = yield* Result.await(
            Result.tryPromise({
               try: () => transport.read(),
               catch: () => createProblem('quest.companion.read-failed')
            })
         );
         if (isIdle(chunk)) {
            if (next > 0 && chunk.length === 4) return Result.err(createProblem('quest.companion.reset'));
            await waitAbortable(idleReadMs, signal);
            continue;
         }

         const [high = 0, low = 0] = chunk;
         const header = (high << 8) | low;
         if ((header & ~lastFragment) !== next) return Result.err(createProblem('quest.companion.out-of-order'));
         next += 1;
         parts.push(...chunk.subarray(2));
         if (parts.length > maxMessageBytes) return Result.err(createProblem('quest.companion.too-large'));
         if (header & lastFragment) return Result.ok(Uint8Array.from(parts));
      }
      return Result.err(createProblem(signal.aborted ? 'quest.companion.cancelled' : 'quest.companion.timed-out'));
   });
}

function drain(transport: CompanionTransport, signal: AbortSignal) {
   return Result.gen(async function* () {
      for (let attempt = 0; attempt < 16; attempt += 1) {
         if (signal.aborted) return Result.err(createProblem('quest.companion.cancelled'));
         const chunk = yield* Result.await(
            Result.tryPromise({
               try: () => transport.read(),
               catch: () => createProblem('quest.companion.drain-failed')
            })
         );
         if (isIdle(chunk)) return Result.ok(undefined);
      }
      return Result.err(createProblem('quest.companion.busy'));
   });
}

function decodeReply(bytes: Uint8Array, sequence: number): Result<Reply, Problem> {
   return Result.gen(function* () {
      const fields = yield* readFields(bytes);
      if (varintOf(fields, 1) !== sequence) return Result.err(createProblem('quest.companion.sequence'));
      const code = varintOf(fields, 2) ?? 0;
      const body = bytesOf(fields, 3) ?? new Uint8Array();
      const success: Reply = { ok: true, body };
      if (code === 0) return Result.ok(success);

      const details = yield* readFields(body);
      const failure: Reply = { ok: false, code: varintOf(details, 1) ?? code, codeV2: varintOf(details, 5) ?? null };
      return Result.ok(failure);
   });
}

function certificatePublicKey(der: Uint8Array<ArrayBuffer>): Result<Uint8Array<ArrayBuffer>, Problem> {
   const invalid = Result.err(createProblem('quest.companion.certificate'));
   const element = (start: number, end: number) => {
      const tag = der[start];
      let length = der[start + 1];
      let content = start + 2;
      if (tag === undefined || length === undefined) return null;
      if (length & 128) {
         const size = length & 127;
         if (!size || size > 4 || content + size > end) return null;
         length = 0;
         for (let index = 0; index < size; index += 1) length = length * 256 + (der[content + index] ?? 0);
         content += size;
      }
      return content + length > end ? null : { tag, start, content, end: content + length };
   };

   const certificate = element(0, der.length);
   const tbs = certificate && element(certificate.content, certificate.end);
   if (!tbs || certificate.tag !== 0x30 || tbs.tag !== 0x30) return invalid;
   let current = element(tbs.content, tbs.end);
   if (current?.tag === 0xa0) current = element(current.end, tbs.end);
   for (let index = 0; index < 5 && current; index += 1) current = element(current.end, tbs.end);
   return current?.tag === 0x30 ? Result.ok(der.slice(current.start, current.end)) : invalid;
}

async function verifyHello(certificate: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>, signedData: Uint8Array, challenge: Uint8Array) {
   const publicKey = certificatePublicKey(certificate);
   if (Result.isError(publicKey)) return publicKey;
   const verified = await Result.tryPromise(async () => {
      const key = await crypto.subtle.importKey('spki', publicKey.value, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, Uint8Array.from([...signedData, ...challenge]));
   });
   return Result.isOk(verified) && verified.value ? Result.ok(undefined) : Result.err(createProblem('quest.companion.signature'));
}

function openSession(serverPublicKey: Uint8Array, secretKey: Uint8Array): Session {
   const shared = nacl.box.before(serverPublicKey, secretKey);
   return {
      encrypt: (plain) => {
         const nonce = nacl.randomBytes(nonceBytes);
         return Uint8Array.from([...nonce, ...nacl.box.after(plain, nonce, shared)]);
      },
      decrypt: (packet) => {
         const opened = packet.length > nonceBytes ? nacl.box.open.after(packet.subarray(nonceBytes), packet.subarray(0, nonceBytes), shared) : null;
         return opened ? Result.ok(opened) : Result.err(createProblem('quest.companion.decrypt'));
      }
   };
}

function deviceProblem(reply: Extract<Reply, { ok: false }>, action: 'start' | 'check' | 'enable' | 'pair') {
   const hint =
      reply.codeV2 === 1045
         ? 'owner'
         : reply.codeV2 === 1046
           ? 'setup'
           : reply.code === 16
             ? 'wifi'
             : reply.code === 19
               ? 'account'
               : reply.code === 20
                 ? 'update'
                 : 'awake';
   return createProblem('quest.companion.device-error', {
      action,
      hint,
      cause: `code ${reply.code}${reply.codeV2 === null ? '' : `/${reply.codeV2}`}`
   });
}

function readPairing(body: Uint8Array): Result<Pairing, Problem> {
   return Result.gen(function* () {
      const fields = yield* readFields(body);
      const host = bytesOf(fields, 1);
      const pairingCode = bytesOf(fields, 3);
      const pairing: Pairing = {
         host: host?.length ? new TextDecoder().decode(host) : undefined,
         pairingPort: varintOf(fields, 2) || undefined,
         pairingCode: pairingCode?.length ? new TextDecoder().decode(pairingCode) : undefined,
         connectionPort: varintOf(fields, 4) || null
      };
      if (pairing.pairingCode !== undefined && !/^\d{6}$/.test(pairing.pairingCode)) return Result.err(createProblem('quest.companion.pairing-code'));
      if (pairing.host !== undefined && !/^[\d.]+$|^[\da-f:]+$/i.test(pairing.host))
         return Result.err(createProblem('quest.companion.pairing-address'));
      return Result.ok(pairing);
   });
}

export function runCompanionSetup({ transport, prove, onPhase, signal }: CompanionSetup) {
   return Result.gen(async function* () {
      const keys = nacl.box.keyPair();
      const challenge = nacl.randomBytes(16);

      onPhase('handshake');
      yield* Result.await(drain(transport, signal));
      const helloBody = Uint8Array.from([...bytesField(1, keys.publicKey), ...bytesField(2, challenge)]);
      const hello = yield* decodeReply(yield* Result.await(exchange(transport, encodeRequest(method.hello, 1, helloBody), signal)), 1);
      if (!hello.ok) return Result.err(deviceProblem(hello, 'start'));

      const helloFields = yield* readFields(hello.body);
      const signedData = bytesOf(helloFields, 1);
      const signature = bytesOf(helloFields, 2);
      const certificate = bytesOf(helloFields, 3);
      if (!signedData || !signature || !certificate) return Result.err(createProblem('quest.companion.hello'));
      const signed = yield* readFields(signedData);
      const serverPublicKey = bytesOf(signed, 1);
      const ownerChallenge = bytesOf(signed, 2);
      if (serverPublicKey?.length !== 32 || !ownerChallenge?.length) return Result.err(createProblem('quest.companion.hello'));
      if (varintOf(signed, 3) === 1) return Result.err(createProblem('quest.companion.locked'));
      yield* Result.await(verifyHello(certificate, signature, signedData, challenge));

      const session = openSession(serverPublicKey, keys.secretKey);
      let sequence = 2;
      const call = (methodId: number, body?: Uint8Array) =>
         Result.gen(async function* () {
            const current = sequence;
            sequence += 1;
            const packet = yield* Result.await(exchange(transport, session.encrypt(encodeRequest(methodId, current, body)), signal));
            return decodeReply(yield* session.decrypt(packet), current);
         });

      onPhase('authenticate');
      const proof = yield* Result.await(prove(ownerChallenge));
      const authenticated = yield* Result.await(call(method.authenticate, Uint8Array.from(bytesField(1, proof))));
      if (!authenticated.ok) {
         return Result.err(createProblem('quest.companion.owner'));
      }

      onPhase('developer-mode');
      const developerMode = () =>
         Result.gen(async function* () {
            const status = yield* Result.await(call(method.developerModeStatus));
            if (!status.ok) return Result.err(deviceProblem(status, 'check'));
            return Result.ok(varintOf(yield* readFields(status.body), 1) === 1);
         });
      if (!(yield* Result.await(developerMode()))) {
         const enabling = yield* Result.await(call(method.enableDeveloperMode, Uint8Array.from(varintField(1, 1))));
         if (!enabling.ok) return Result.err(deviceProblem(enabling, 'enable'));
         if (!(yield* Result.await(developerMode()))) return Result.err(createProblem('quest.companion.developer-mode'));
      }

      onPhase('pairing');
      const deadline = Date.now() + pairingTimeoutMs;
      let connectionPort: number | null = null;
      let restarted = false;
      let onlyConnectionSince: number | null = null;
      let methodId = method.startPairing;
      while (Date.now() < deadline && !signal.aborted) {
         const reply = yield* Result.await(call(methodId));
         if (!reply.ok) return Result.err(deviceProblem(reply, 'pair'));
         const pairing = yield* readPairing(reply.body);
         connectionPort = pairing.connectionPort ?? connectionPort;
         const { host, pairingPort, pairingCode } = pairing;
         if (host && pairingPort && pairingCode) return Result.ok<QuestPairingRequest>({ host, pairingPort, pairingCode, connectionPort });

         onlyConnectionSince = connectionPort !== null && !pairingPort && !pairingCode ? (onlyConnectionSince ?? Date.now()) : null;
         const restart = !restarted && onlyConnectionSince !== null && Date.now() - onlyConnectionSince >= 5_000;
         if (restart) {
            restarted = true;
            connectionPort = null;
            onlyConnectionSince = null;
         }
         methodId = restart ? method.startPairing : method.pairingStatus;
         await waitAbortable(500, signal);
      }
      return Result.err(createProblem(signal.aborted ? 'quest.companion.cancelled' : 'quest.companion.pairing-timed-out'));
   });
}
