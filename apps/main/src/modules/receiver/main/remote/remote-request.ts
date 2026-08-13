import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcError, IpcFailureResult } from '@/ipc/core';
import type { TargetCallResult, TargetUpload, UploadInput } from '@/lib/api';
import { requestReceiverJson, uploadReceiverFile, type ReceiverTransportFailure } from '@/modules/receiver/main/remote-receiver-transport';
import type { RemoteSessionManager } from '@/modules/receiver/main/remote/remote-session';
import { receiverProcedureEnvelopeSchema, receiverProcedurePath, receiverUploadPath } from '@/modules/receiver/main/target-api';
import { targetCapabilitySchema, type TargetCapability, type TargetId } from '@/modules/targets/contract';

export function createRemoteRequest(manager: RemoteSessionManager) {
   function requireCapability(targetId: TargetId, capability: TargetCapability) {
      const session = manager.sessions.get(targetId);
      if (!session?.token || !session.target.capabilities.includes(capability)) return null;

      return { session, token: session.token };
   }

   async function targetProcedure(
      targetId: TargetId,
      namespace: string,
      method: string,
      authorisation: TargetCapability | { capability: TargetCapability },
      input: z.infer<ReturnType<typeof z.json>>
   ): Promise<TargetCallResult<z.infer<ReturnType<typeof z.json>>>> {
      const wrappedCapability = z.object({ capability: targetCapabilitySchema }).safeParse(authorisation);
      const capability = wrappedCapability.success ? wrappedCapability.data.capability : targetCapabilitySchema.parse(authorisation);
      const authorised = requireCapability(targetId, capability);
      if (!authorised) return { status: 'unsupported', targetId, capability };

      const response = await requestReceiverJson({
         endpoint: authorised.session.endpoint,
         path: receiverProcedurePath(namespace, method),
         method: 'POST',
         schema: receiverProcedureEnvelopeSchema,
         token: authorised.token,
         body: input
      });
      if (Result.isError(response)) {
         manager.applyFailure(authorised.session, response.error);
         return {
            status: 'unavailable',
            targetId,
            error: { code: response.error.code, message: response.error.message }
         };
      }

      return { status: 'ok', targetId, value: response.value.value };
   }

   async function targetUpload<Upload extends TargetUpload>(
      targetId: TargetId,
      namespace: string,
      method: string,
      upload: Upload,
      input: UploadInput<Upload>,
      file: { path: string; sizeBytes: number }
   ): Promise<TargetCallResult<void>> {
      const authorised = requireCapability(targetId, upload.capability);
      if (!authorised) return { status: 'unsupported', targetId, capability: upload.capability };

      const uploaded = await uploadReceiverFile({
         endpoint: authorised.session.endpoint,
         path: receiverUploadPath(namespace, method),
         value: input,
         token: authorised.token,
         sourcePath: file.path,
         sizeBytes: file.sizeBytes
      });
      if (Result.isError(uploaded)) {
         manager.applyFailure(authorised.session, uploaded.error);
         return {
            status: 'unavailable',
            targetId,
            error: { code: uploaded.error.code, message: uploaded.error.message }
         };
      }

      return { status: 'ok', targetId, value: undefined };
   }

   return { targetProcedure, targetUpload };
}

export type RemoteRequest = ReturnType<typeof createRemoteRequest>;

export function toIpcError(failureDetail: ReceiverTransportFailure): IpcError {
   return {
      code: failureDetail.code,
      message: failureDetail.message
   };
}

export function failure(code: string, message: string): IpcFailureResult {
   return {
      ok: false,
      error: { code, message }
   };
}
