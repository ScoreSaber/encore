import { Result } from 'better-result';
import { z } from 'zod';

import { hasUploads, type TargetApiModule, type TargetUploadFailure, type UploadTargetApiModule } from '@/lib/api';
import { readJsonBody, writeError, writeJson } from '@/modules/receiver/main/receiver-http';
import type { Route } from '@/modules/receiver/main/routes/route-table';
import { receiverProtocolVersion } from '@/modules/receiver/protocol';

export function receiverProcedurePath(namespace: string, method: string): `/rpc/${string}/${string}` {
   return `/rpc/${namespace}/${method}`;
}

export function receiverUploadPath(namespace: string, method: string): `/upload/${string}/${string}` {
   return `/upload/${namespace}/${method}`;
}

export const receiverProcedureEnvelopeSchema = z.object({
   protocolVersion: z.int().positive(),
   value: z.json()
});

export function defineReceiverApiRoutes(modules: readonly TargetApiModule[]) {
   return modules.flatMap((module) => [...defineProcedureRoutes(module), ...(hasUploads(module) ? defineUploadRoutes(module) : [])]);
}

function defineProcedureRoutes({ api, handlers }: TargetApiModule) {
   return Object.entries(api.procedures).map(
      ([method, procedure]): Route => ({
         method: 'POST',
         path: receiverProcedurePath(api.namespace, method),
         authenticated: true,
         handle: async (request, response) => {
            const body = procedure.input ? await readJsonBody(request) : Result.ok({});
            if (Result.isError(body)) return writeError(response, body.error);

            const input = procedure.input ? procedure.input.safeParse(body.value) : { success: true, data: {} };
            if (!input.success) {
               return writeError(response, {
                  status: 400,
                  code: 'receiver.rpc.invalid-request',
                  message: 'Receiver request is invalid'
               });
            }

            const handler = Reflect.get(handlers, method);
            const value = await Reflect.apply(handler, undefined, [input.data]);
            writeJson(response, 200, { protocolVersion: receiverProtocolVersion, value });
         }
      })
   );
}

function defineUploadRoutes({ api, uploadHandlers }: UploadTargetApiModule) {
   return Object.entries(api.uploads).map(
      ([method, upload]): Route => ({
         method: 'POST',
         path: receiverUploadPath(api.namespace, method),
         authenticated: true,
         handle: async (request, response) => {
            const encoded = new URL(request.url ?? '/', 'https://receiver.local').searchParams.get('input');
            const input = Result.try({
               try: () => upload.input.safeParse(JSON.parse(encoded ?? '')),
               catch: () => ({
                  status: 400,
                  code: 'receiver.upload.invalid-request',
                  message: 'Receiver upload request is invalid'
               })
            });
            if (Result.isError(input)) return writeError(response, input.error);
            if (!input.value.success) {
               return writeError(response, {
                  status: 400,
                  code: 'receiver.upload.invalid-request',
                  message: 'Receiver upload request is invalid'
               });
            }

            const handler = Reflect.get(uploadHandlers, method) as (
               input: object,
               source: AsyncIterable<Uint8Array>
            ) => Promise<Result<void, TargetUploadFailure>>;
            const uploaded = await handler(input.value.data, request);
            if (Result.isError(uploaded)) {
               return writeError(response, {
                  status: uploaded.error.kind === 'not-found' ? 404 : uploaded.error.kind === 'unavailable' ? 500 : 400,
                  code: uploaded.error.code,
                  message: uploaded.error.message
               });
            }

            writeJson(response, 200, { protocolVersion: receiverProtocolVersion });
         }
      })
   );
}
