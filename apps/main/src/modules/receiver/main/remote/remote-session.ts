import { Result } from 'better-result';

import type { ReceiverRemoteForgetResult, ReceiverRemotePairRequest, ReceiverRemotePairResult } from '@/modules/receiver/contract';
import type { RemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import {
   openReceiverEventStream,
   parseReceiverHost,
   probeReceiverIdentity,
   requestReceiverOperation,
   type ReceiverEndpoint,
   type ReceiverEventStream,
   type ReceiverStreamStatus,
   type ReceiverTransportFailure
} from '@/modules/receiver/main/remote-receiver-transport';
import type { RemoteEvents } from '@/modules/receiver/main/remote/remote-events';
import { failure, toIpcError } from '@/modules/receiver/main/remote/remote-request';
import { receiverOperations } from '@/modules/receiver/operations';
import { receiverDeviceNameSchema } from '@/modules/receiver/protocol';
import type { RemoteTargetRecord } from '@/modules/settings/contract';
import type { Target, TargetHealth, TargetId } from '@/modules/targets/contract';

import { createHash } from 'node:crypto';

export type RemoteSession = {
   record: RemoteTargetRecord;
   endpoint: ReceiverEndpoint;
   token: string | null;
   tokenPersisted: boolean;
   target: Target;
   stream: ReceiverEventStream | null;
};

export const insecureStorageMessage = 'Secure storage is unavailable, so this pairing is only kept until Encore closes';

export function createRemoteSessionManager(options: { store: RemoteTargetStore; events: RemoteEvents }) {
   const sessions = new Map<TargetId, RemoteSession>();

   async function restore() {
      const records = await options.store.listRecords();

      for (const record of records) {
         const { token, persisted } = await options.store.readToken(record.id);
         const session = createSession(record, token, persisted);
         sessions.set(record.id, session);
         options.events.emitTarget(session);

         if (token) connect(session);
      }
   }

   async function pair(request: ReceiverRemotePairRequest): Promise<ReceiverRemotePairResult> {
      const deviceName = receiverDeviceNameSchema.safeParse(request.deviceName);
      if (!deviceName.success) return failure('receiver.remote.device-name.invalid', 'Device name is required');

      const address = parseReceiverHost(request.host);
      if (Result.isError(address)) return { ok: false, error: toIpcError(address.error) };

      const identity = await probeReceiverIdentity(address.value);
      if (Result.isError(identity)) return { ok: false, error: toIpcError(identity.error) };

      const endpoint: ReceiverEndpoint = {
         ...address.value,
         certificatePem: identity.value.certificatePem,
         fingerprint: identity.value.fingerprint
      };
      const targetId = createRemoteTargetId(endpoint);
      const existing = sessions.get(targetId);

      if (existing && existing.record.fingerprint !== endpoint.fingerprint) {
         return failure(
            'receiver.remote.identity.changed',
            'This receiver presents a different identity than the one paired earlier. Forget it first, then pair again'
         );
      }

      const started = await requestReceiverOperation({
         endpoint,
         operation: receiverOperations.pairStart,
         body: { deviceName: deviceName.data }
      });
      if (Result.isError(started)) return { ok: false, error: toIpcError(started.error) };
      if (started.value.pairing.status !== 'waiting') {
         return failure('receiver.remote.pairing.not-started', 'Start pairing on the receiver first');
      }

      const completed = await requestReceiverOperation({
         endpoint,
         operation: receiverOperations.pairComplete,
         body: { code: request.pairingCode, deviceName: deviceName.data }
      });
      if (Result.isError(completed)) return { ok: false, error: toIpcError(completed.error) };

      const record: RemoteTargetRecord = {
         id: targetId,
         name: identity.value.name,
         host: endpoint.host,
         port: endpoint.port,
         fingerprint: endpoint.fingerprint,
         certificatePem: endpoint.certificatePem,
         pairedAt: new Date().toISOString()
      };

      const written = await options.store.saveRecord(record);
      if (!written.ok) return { ok: false, error: written.error };

      const tokenState = await options.store.saveToken(targetId, completed.value.token);

      existing?.stream?.close();
      const session = createSession(record, tokenState.token, tokenState.persisted);
      session.target = {
         ...session.target,
         status: 'ready',
         capabilities: completed.value.target.capabilities,
         message: tokenState.persisted ? undefined : insecureStorageMessage
      };
      sessions.set(targetId, session);
      options.events.emitTarget(session);
      connect(session);

      return { ok: true, value: session.target };
   }

   async function forget(targetId: TargetId): Promise<ReceiverRemoteForgetResult> {
      const session = sessions.get(targetId);
      if (!session) return failure('receiver.remote.not-found', 'Remote receiver was not found');

      session.stream?.close();
      sessions.delete(targetId);

      const removed = await options.store.removeRecord(targetId);
      if (!removed.ok) return { ok: false, error: removed.error };

      options.events.emit({ type: 'target-removed', targetId });
      return { ok: true, value: targetId };
   }

   function listTargets() {
      return [...sessions.values()].map((session) => session.target);
   }

   async function getHealth(targetId: TargetId): Promise<TargetHealth | null> {
      const session = sessions.get(targetId);
      if (!session) return null;
      if (!session.token) return describeHealth(session);

      const capabilities = await requestReceiverOperation({
         endpoint: session.endpoint,
         operation: receiverOperations.capabilities,
         token: session.token
      });

      if (Result.isError(capabilities)) {
         applyFailure(session, capabilities.error);
         return describeHealth(session);
      }

      options.events.updateTarget(session, {
         status: 'ready',
         capabilities: capabilities.value.target.capabilities,
         message: session.tokenPersisted ? undefined : insecureStorageMessage
      });

      return describeHealth(session);
   }

   function connect(session: RemoteSession) {
      session.stream?.close();
      session.stream = openReceiverEventStream({
         endpoint: session.endpoint,
         getToken: () => session.token,
         onEvent: (event) => {
            options.events.handleStreamEvent(session, event);
         },
         onStatus: (status) => {
            handleStreamStatus(session, status);
         }
      });
   }

   function handleStreamStatus(session: RemoteSession, status: ReceiverStreamStatus) {
      if (status.type === 'connected') {
         void refreshCapabilities(session);
         return;
      }

      if (status.type === 'reconnecting') {
         options.events.updateTarget(session, { status: 'disconnected', capabilities: [], message: status.message });
         return;
      }

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

   async function refreshCapabilities(session: RemoteSession) {
      await getHealth(session.record.id);
   }

   function applyFailure(session: RemoteSession, failureDetail: ReceiverTransportFailure) {
      if (failureDetail.kind === 'auth') {
         session.token = null;
         session.stream?.close();
         session.stream = null;
         options.events.updateTarget(session, { status: 'unpaired', capabilities: [], message: failureDetail.message });
         return;
      }

      if (failureDetail.kind === 'identity' || failureDetail.kind === 'protocol') {
         session.stream?.close();
         session.stream = null;
         options.events.updateTarget(session, { status: 'incompatible', capabilities: [], message: failureDetail.message });
         return;
      }

      options.events.updateTarget(session, { status: 'disconnected', capabilities: [], message: failureDetail.message });
   }

   function dispose() {
      for (const session of sessions.values()) {
         session.stream?.close();
         session.stream = null;
      }
   }

   return { sessions, restore, pair, forget, listTargets, getHealth, applyFailure, dispose };
}

export type RemoteSessionManager = ReturnType<typeof createRemoteSessionManager>;

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
         address: `${record.host}:${record.port}`,
         fingerprint: record.fingerprint,
         message: token ? undefined : 'Pairing token is unavailable. Pair this receiver again'
      },
      stream: null
   };
}

function describeHealth(session: RemoteSession): TargetHealth {
   return {
      status: session.target.status,
      capabilities: session.target.capabilities,
      message: session.target.message
   };
}

export function createRemoteTargetId(endpoint: { host: string; port: number }) {
   return `remote_${createHash('sha256').update(`${endpoint.host}:${endpoint.port}`).digest('hex').slice(0, 12)}`;
}
