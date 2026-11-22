import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { parseReceiverHost, receiverAddressUrl } from '@/modules/receiver/address';
import type { ReceiverRemotePairRequest } from '@/modules/receiver/contract';
import type { RemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import {
   openReceiverEventStream,
   probeReceiverIdentity,
   requestReceiverOperation,
   type ReceiverEndpoint,
   type ReceiverEventStream,
   type ReceiverStreamStatus,
   type ReceiverTransportFailure
} from '@/modules/receiver/main/remote-receiver-transport';
import type { RemoteEvents } from '@/modules/receiver/main/remote/remote-events';
import { receiverOperations } from '@/modules/receiver/operations';
import type { RemoteTargetRecord } from '@/modules/settings/contract';
import type { Target, TargetId } from '@/modules/targets/contract';

import { createHash } from 'node:crypto';

export type RemoteSession = {
   record: RemoteTargetRecord;
   endpoint: ReceiverEndpoint;
   token: string | null;
   tokenPersisted: boolean;
   target: Target;
   attached: Target[];
   stream: ReceiverEventStream | null;
   streamEpoch: number;
   lifecycle: 'active' | 'forgetting' | 'forgotten';
};

export const insecureStorageMessage = translate('targets.remote.insecureStorage');

export function createRemoteSessionManager(options: { store: RemoteTargetStore; events: RemoteEvents }) {
   const sessions = new Map<TargetId, RemoteSession>();
   const mutatedDuringRestore = new Set<TargetId>();
   let disposed = false;

   async function restore() {
      const records = await options.store.listRecords();
      if (disposed) return;

      for (const record of records) {
         const { token, persisted } = await options.store.readToken(record.id);
         if (disposed || mutatedDuringRestore.has(record.id) || sessions.has(record.id)) continue;

         const session = createSession(record, token, persisted);
         sessions.set(record.id, session);
         options.events.emitTarget(session);

         if (token) connect(session);
      }
   }

   function pair(request: ReceiverRemotePairRequest): Promise<Result<Target, Problem>> {
      return Result.gen(async function* () {
         const address = yield* parseReceiverHost(request.host);
         const identity = yield* Result.await(probeReceiverIdentity(address));
         const endpoint: ReceiverEndpoint = {
            ...address,
            certificatePem: identity.certificatePem,
            fingerprint: identity.fingerprint
         };
         const targetId = createRemoteTargetId(endpoint);
         const existing = sessions.get(targetId);
         if (existing && existing.record.fingerprint !== endpoint.fingerprint) return Result.err(createProblem('receiver.remote.identity.mismatch'));

         const started = yield* Result.await(
            requestReceiverOperation({ endpoint, operation: receiverOperations.pairStart, body: { deviceName: request.deviceName } })
         );
         if (started.pairing.status !== 'waiting') return Result.err(createProblem('receiver.remote.pairing.not-started'));

         const completed = yield* Result.await(
            requestReceiverOperation({
               endpoint,
               operation: receiverOperations.pairComplete,
               body: { code: request.pairingCode, deviceName: request.deviceName }
            })
         );

         const record: RemoteTargetRecord = {
            id: targetId,
            name: identity.name,
            host: endpoint.host,
            port: endpoint.port,
            fingerprint: endpoint.fingerprint,
            certificatePem: endpoint.certificatePem,
            pairedAt: new Date().toISOString()
         };
         const written = await options.store.saveRecord(record);
         if (!written.ok) return Result.err(written.error);

         const tokenState = await options.store.saveToken(targetId, completed.token);
         mutatedDuringRestore.add(targetId);
         const current = sessions.get(targetId);
         current?.stream?.close();
         if (current) options.events.updateAttached(current, []);

         const session = createSession(record, tokenState.token, tokenState.persisted);
         session.target = {
            ...session.target,
            status: completed.target.status,
            capabilities: completed.target.capabilities,
            message: completed.target.message ?? (tokenState.persisted ? undefined : insecureStorageMessage)
         };
         sessions.set(targetId, session);
         options.events.emitTarget(session);
         if (session.target.status === 'ready') options.events.updateAttached(session, completed.attached);
         if (!disposed) connect(session);

         return Result.ok(session.target);
      });
   }

   async function forget(targetId: TargetId): Promise<Result<TargetId, Problem>> {
      const session = sessions.get(targetId);
      if (!session || session.lifecycle !== 'active') return Result.err(createProblem('receiver.remote.not-found'));

      session.lifecycle = 'forgetting';
      session.streamEpoch += 1;
      session.stream?.close();
      session.stream = null;

      const removed = await options.store.removeRecord(targetId);
      if (!removed.ok) {
         if (!disposed && sessions.get(targetId) === session && session.lifecycle === 'forgetting') {
            session.lifecycle = 'active';
            if (session.token) connect(session);
         }
         return Result.err(removed.error);
      }

      mutatedDuringRestore.add(targetId);
      if (sessions.get(targetId) === session) {
         session.lifecycle = 'forgotten';
         sessions.delete(targetId);
         options.events.updateAttached(session, []);
      }

      options.events.emit({ type: 'target-removed', targetId });
      return Result.ok(targetId);
   }

   function listTargets() {
      return [...sessions.values()].flatMap((session) => [session.target, ...session.attached]);
   }

   function resolve(targetId: TargetId) {
      const separator = targetId.indexOf(relayedTargetSeparator);
      const session = sessions.get(separator === -1 ? targetId : targetId.slice(0, separator));
      if (!session) return null;
      if (separator === -1) return { session, target: session.target, hostedTargetId: undefined };

      const target = session.attached.find((candidate) => candidate.id === targetId);
      return target ? { session, target, hostedTargetId: targetId.slice(separator + 1) } : null;
   }

   async function refreshHealth(session: RemoteSession) {
      if (!session.token) return;
      const epoch = session.streamEpoch;

      const capabilities = await requestReceiverOperation({
         endpoint: session.endpoint,
         operation: receiverOperations.capabilities,
         token: session.token
      });
      if (!isCurrent(session) || session.streamEpoch !== epoch) return;

      if (Result.isError(capabilities)) {
         applyFailure(session, capabilities.error);
         return;
      }

      options.events.updateTarget(session, {
         status: capabilities.value.target.status,
         capabilities: capabilities.value.target.capabilities,
         message: capabilities.value.target.message ?? (session.tokenPersisted ? undefined : insecureStorageMessage)
      });
      if (session.target.status === 'ready') options.events.updateAttached(session, capabilities.value.attached);
   }

   function connect(session: RemoteSession) {
      session.streamEpoch += 1;
      session.stream?.close();
      const stream = openReceiverEventStream({
         endpoint: session.endpoint,
         getToken: () => session.token,
         onEvent: (event) => {
            if (!isCurrent(session) || session.stream !== stream) return;
            options.events.handleStreamEvent(session, event);
         },
         onStatus: (status) => {
            if (!isCurrent(session) || session.stream !== stream) return;
            handleStreamStatus(session, status);
         }
      });
      session.stream = stream;
   }

   function handleStreamStatus(session: RemoteSession, status: ReceiverStreamStatus) {
      if (status.type === 'connected') {
         void refreshHealth(session);
         return;
      }

      if (status.type === 'reconnecting') {
         options.events.updateTarget(session, { status: 'disconnected', message: status.message });
         return;
      }

      session.streamEpoch += 1;

      if (status.type === 'identity-changed') {
         session.stream?.close();
         session.stream = null;
         options.events.updateTarget(session, { status: 'incompatible', capabilities: [], message: status.message });
         return;
      }

      session.stream?.close();
      session.stream = null;
      session.token = null;
      options.events.updateTarget(session, { status: 'unpaired', capabilities: [], message: status.message });
   }

   function isCurrent(session: RemoteSession) {
      return !disposed && sessions.get(session.record.id) === session && session.lifecycle === 'active';
   }

   function applyFailure(session: RemoteSession, failureDetail: ReceiverTransportFailure) {
      if (!isCurrent(session) || failureDetail.kind === 'network' || failureDetail.kind === 'invalid' || failureDetail.kind === 'missing') return;

      session.streamEpoch += 1;
      if (failureDetail.kind === 'auth') {
         session.token = null;
         session.stream?.close();
         session.stream = null;
         options.events.updateTarget(session, { status: 'unpaired', capabilities: [], message: failureDetail.message });
         return;
      }

      session.stream?.close();
      session.stream = null;
      options.events.updateTarget(session, { status: 'incompatible', capabilities: [], message: failureDetail.message });
   }

   function dispose() {
      disposed = true;
      for (const session of sessions.values()) {
         session.streamEpoch += 1;
         session.stream?.close();
         session.stream = null;
      }
   }

   return { resolve, restore, pair, forget, listTargets, applyFailure, dispose };
}

function createSession(record: RemoteTargetRecord, token: string | null, tokenPersisted: boolean): RemoteSession {
   return {
      record,
      endpoint: {
         host: record.host,
         port: record.port,
         certificatePem: record.certificatePem,
         fingerprint: record.fingerprint
      },
      token,
      tokenPersisted,
      target: {
         id: record.id,
         kind: 'remote',
         name: record.name,
         status: token ? 'disconnected' : 'unpaired',
         capabilities: [],
         address: receiverAddressUrl(record),
         fingerprint: record.fingerprint,
         message: token ? undefined : translate('targets.remote.unpaired')
      },
      attached: [],
      stream: null,
      streamEpoch: 0,
      lifecycle: 'active'
   };
}

const relayedTargetSeparator = '/';

export function relayedTargetId(remoteTargetId: TargetId, hostedTargetId: string) {
   return `${remoteTargetId}${relayedTargetSeparator}${hostedTargetId}`;
}

export function createRemoteTargetId(endpoint: { host: string; port: number }) {
   return `remote_${createHash('sha256').update(`${endpoint.host}:${endpoint.port}`).digest('hex').slice(0, 12)}`;
}
