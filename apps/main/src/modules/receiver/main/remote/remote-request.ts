import { Result } from 'better-result';
import type { z } from 'zod';

import type { IpcError, IpcFailureResult } from '@/ipc/core';
import type { ProcedureInput, ProcedureOutput, TargetCallResult, TargetProcedure, TargetUpload, UploadInput } from '@/lib/api';
import { requestReceiverJson, uploadReceiverFile, type ReceiverTransportFailure } from '@/modules/receiver/main/remote-receiver-transport';
import type { RemoteSessionManager } from '@/modules/receiver/main/remote/remote-session';
import { receiverProcedureEnvelopeSchema, receiverProcedurePath, receiverUploadPath } from '@/modules/receiver/main/target-api';
import type { TargetCapability, TargetId } from '@/modules/targets/contract';

export function createRemoteRequest(manager: RemoteSessionManager) {
   function requireCapability(targetId: TargetId, capability: TargetCapability) {
      const session = manager.sessions.get(targetId);
      if (!session?.token || !session.target.capabilities.includes(capability)) return null;

      return { session, token: session.token };
   }

   function targetProcedure<Procedure extends TargetProcedure>(
      targetId: TargetId,
      namespace: string,
      method: string,
      procedure: Procedure,
      input: ProcedureInput<Procedure>
   ): Promise<TargetCallResult<ProcedureOutput<Procedure>>>;
   async function targetProcedure(
      targetId: TargetId,
      namespace: string,
      method: string,
      procedure: { capability: TargetCapability; output: z.ZodType },
      input: unknown
   ): Promise<TargetCallResult<unknown>> {
      const authorised = requireCapability(targetId, procedure.capability);
      if (!authorised) return { status: 'unsupported', targetId, capability: procedure.capability };

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

      const value = procedure.output.safeParse(response.value.value);
      if (!value.success) {
         return {
            status: 'unavailable',
            targetId,
            error: { code: 'receiver.remote.response.invalid', message: 'Receiver response did not match the procedure output' }
         };
      }

      return { status: 'ok', targetId, value: value.data };
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
