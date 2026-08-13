import { Result } from 'better-result';
import { z } from 'zod';

import {
   getUpload,
   type ApiMethod,
   type ApiModule,
   type ApiUpload,
   type ApiUploadMethod,
   type DomainApi,
   type ProcedureInput,
   type ProcedureOutput,
   type TargetCallResult,
   type UploadHandlers,
   type UploadInput
} from '@/lib/api';
import type { RemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { localTargetId, type Target, type TargetCapability, type TargetEvent, type TargetHealth, type TargetId } from '@/modules/targets/contract';
import { getLocalTarget, getLocalTargetHealth } from '@/modules/targets/main/local-target';

import { createReadStream } from 'node:fs';

export type TargetRegistry = ReturnType<typeof createTargetRegistry>;

export function createTargetRegistry(options: { remote: RemoteReceiverClient }) {
   function listTargets(): Target[] {
      return [getLocalTarget(), ...options.remote.listTargets()];
   }

   const supports = (targetId: TargetId, capability: TargetCapability) =>
      listTargets().some((target) => target.id === targetId && target.capabilities.includes(capability));

   async function getHealth(targetId: TargetId): Promise<TargetHealth | null> {
      if (targetId === localTargetId) return getLocalTargetHealth();

      return options.remote.getHealth(targetId);
   }

   function subscribe(listener: (event: TargetEvent) => void) {
      return options.remote.subscribe(listener);
   }

   async function callTarget<Api extends DomainApi, Method extends ApiMethod<Api>>(
      local: ApiModule<Api>,
      method: Method,
      targetId: TargetId,
      input: ProcedureInput<Api['procedures'][Method]>
   ): Promise<TargetCallResult<ProcedureOutput<Api['procedures'][Method]>>> {
      const procedure = requireProcedure(local.api.procedures[method], local.api.namespace, method);
      if (!supports(targetId, procedure.capability)) {
         return { status: 'unsupported', targetId, capability: procedure.capability };
      }

      if (targetId === localTargetId) {
         return { status: 'ok', targetId, value: await local.handlers[method](input) };
      }

      const remote = await options.remote.callTarget(targetId, local.api.namespace, method, procedure.capability, z.json().parse(input));
      if (remote.status !== 'ok') return remote;

      const parsed = procedure.output.pipe(z.custom<ProcedureOutput<Api['procedures'][Method]>>()).safeParse(remote.value);
      return parsed.success
         ? { status: 'ok', targetId, value: parsed.data }
         : {
              status: 'unavailable',
              targetId,
              error: { code: 'receiver.remote.response.invalid', message: 'Receiver response did not match the procedure output' }
           };
   }

   async function uploadTarget<Api extends DomainApi, Method extends ApiUploadMethod<Api>>(
      local: ApiModule<Api> & { uploadHandlers: UploadHandlers<Api> },
      method: Method,
      targetId: TargetId,
      input: UploadInput<ApiUpload<Api, Method>>,
      file: { path: string; sizeBytes: number }
   ): Promise<TargetCallResult<void>> {
      const upload = getUpload(local.api, method);
      if (!supports(targetId, upload.capability)) {
         return { status: 'unsupported', targetId, capability: upload.capability };
      }

      if (targetId !== localTargetId) {
         return options.remote.uploadTarget(targetId, local.api.namespace, method, upload, input, file);
      }

      const uploaded = await local.uploadHandlers[method](input, createReadStream(file.path));
      return Result.isOk(uploaded)
         ? { status: 'ok', targetId, value: undefined }
         : { status: 'unavailable', targetId, error: { code: uploaded.error.code, message: uploaded.error.message } };
   }

   return {
      listTargets,
      getHealth,
      callTarget,
      uploadTarget,
      subscribe
   };
}

function requireProcedure<Procedure>(procedure: Procedure | undefined, namespace: string, method: string): Procedure {
   if (!procedure) throw new Error(`Unknown API procedure: ${namespace}.${method}`);
   return procedure;
}
