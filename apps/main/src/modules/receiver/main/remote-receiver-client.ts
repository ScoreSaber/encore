import { Result } from 'better-result';

import type { ApiInput, ApiJsonValue, DownloadInput, TargetCallResult, TargetDownload, TargetUpload, UploadInput } from '@/lib/api';
import type { RemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import {
   downloadReceiverFile,
   requestReceiverJson,
   uploadReceiverFile,
   type ReceiverTransportFailure
} from '@/modules/receiver/main/remote-receiver-transport';
import { createRemoteEvents } from '@/modules/receiver/main/remote/remote-events';
import { createRemoteSessionManager, type RemoteSession } from '@/modules/receiver/main/remote/remote-session';
import { receiverDownloadPath, receiverProcedureEnvelopeSchema, receiverProcedurePath, receiverUploadPath } from '@/modules/receiver/protocol';
import { localTargetId, type TargetCapability, type TargetId } from '@/modules/targets/contract';

export type RemoteReceiverClient = ReturnType<typeof createRemoteReceiverClient>;

export function createRemoteReceiverClient(options: { store: RemoteTargetStore }) {
   const events = createRemoteEvents();
   const manager = createRemoteSessionManager({ store: options.store, events });

   function requireCapability(targetId: TargetId, capability: TargetCapability) {
      const resolved = manager.resolve(targetId);
      if (!resolved?.session.token || !resolved.target.capabilities.includes(capability)) return null;

      return { session: resolved.session, token: resolved.session.token, hostedTargetId: resolved.hostedTargetId };
   }

   function failed(
      session: RemoteSession,
      targetId: TargetId,
      capability: TargetCapability,
      error: ReceiverTransportFailure
   ): TargetCallResult<never> {
      if (error.kind === 'missing') return { status: 'unsupported', targetId, capability };

      manager.applyFailure(session, error);
      return { status: 'unavailable', targetId, error: { code: error.code, message: error.message } };
   }

   async function targetProcedure(
      targetId: TargetId,
      namespace: string,
      method: string,
      capability: TargetCapability,
      input: ApiInput
   ): Promise<TargetCallResult<ApiJsonValue>> {
      const authorised = requireCapability(targetId, capability);
      if (!authorised) return { status: 'unsupported', targetId, capability };

      const response = await requestReceiverJson({
         endpoint: authorised.session.endpoint,
         path: receiverProcedurePath(namespace, method),
         method: 'POST',
         schema: receiverProcedureEnvelopeSchema,
         token: authorised.token,
         targetId: authorised.hostedTargetId,
         body: input
      });
      if (Result.isError(response)) return failed(authorised.session, targetId, capability, response.error);

      return { status: 'ok', targetId, value: response.value.value };
   }

   async function targetUpload<Upload extends TargetUpload>(
      targetId: TargetId,
      namespace: string,
      method: string,
      upload: Upload,
      input: UploadInput<Upload>,
      file: { path: string; sizeBytes: number },
      signal?: AbortSignal
   ): Promise<TargetCallResult<void>> {
      const authorised = requireCapability(targetId, upload.capability);
      if (!authorised) return { status: 'unsupported', targetId, capability: upload.capability };

      const uploaded = await uploadReceiverFile({
         endpoint: authorised.session.endpoint,
         path: receiverUploadPath(namespace, method),
         value: input,
         token: authorised.token,
         targetId: authorised.hostedTargetId,
         sourcePath: file.path,
         sizeBytes: file.sizeBytes,
         signal
      });
      if (Result.isError(uploaded)) return failed(authorised.session, targetId, upload.capability, uploaded.error);

      return { status: 'ok', targetId, value: undefined };
   }

   async function targetDownload<Download extends TargetDownload>(
      targetId: TargetId,
      namespace: string,
      method: string,
      download: Download,
      input: DownloadInput<Download>,
      destinationPath: string,
      signal?: AbortSignal
   ): Promise<TargetCallResult<{ sizeBytes: number }>> {
      const authorised = requireCapability(targetId, download.capability);
      if (!authorised) return { status: 'unsupported', targetId, capability: download.capability };

      const downloaded = await downloadReceiverFile({
         endpoint: authorised.session.endpoint,
         path: receiverDownloadPath(namespace, method),
         value: input,
         token: authorised.token,
         targetId: authorised.hostedTargetId,
         destinationPath,
         signal
      });
      if (Result.isError(downloaded)) return failed(authorised.session, targetId, download.capability, downloaded.error);

      return { status: 'ok', targetId, value: downloaded.value };
   }

   return {
      callTarget: targetProcedure,
      hostOf: (targetId: TargetId) => {
         const resolved = manager.resolve(targetId);
         return resolved ? { remoteId: resolved.session.target.id, hostedTargetId: resolved.hostedTargetId ?? localTargetId } : null;
      },
      uploadTarget: targetUpload,
      downloadTarget: targetDownload,
      restore: manager.restore,
      pair: manager.pair,
      forget: manager.forget,
      listTargets: manager.listTargets,
      subscribe: events.subscribe,
      subscribeSnapshots: events.subscribeSnapshots,
      dispose: manager.dispose
   };
}
