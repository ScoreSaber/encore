import { Result } from 'better-result';
import { z } from 'zod';

import { ipcTransportValueSchema, type IpcTransportValue } from '@/ipc/core';
import { apiInputSchema, type ApiImplementation, type DomainApi, type TargetUploadFailure } from '@/lib/api';
import { createProblem } from '@/lib/errors';
import type { ProblemCode } from '@/lib/messages';
import { readJsonBody, writeError, writeJson, type HttpFailure } from '@/modules/receiver/main/receiver-http';
import type { ReceiverRouteContext } from '@/modules/receiver/main/receiver-server';
import type { Route } from '@/modules/receiver/main/routes/route-table';
import {
   receiverAttachedTargetIdSchema,
   receiverDownloadPath,
   receiverProcedurePath,
   receiverProtocolVersion,
   receiverTargetIdHeader,
   receiverUploadPath
} from '@/modules/receiver/protocol';
import type { TargetCapability } from '@/modules/targets/contract';

import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const unsupported = failure(404, 'receiver.target.unsupported');
const nestedTargetNotFound = failure(404, 'receiver.target.not-found');

type ServedImplementations = { host: readonly ApiImplementation[]; attached: readonly ApiImplementation[] };

export function defineReceiverApiRoutes(implementations: ServedImplementations) {
   const host = new Map(implementations.host.map((implementation) => [implementation.api.namespace, implementation]));
   const attached = new Map(implementations.attached.map((implementation) => [implementation.api.namespace, implementation]));
   const apis = new Map([...host.values(), ...attached.values()].map(({ api }) => [api.namespace, api]));

   function resolve(request: IncomingMessage, context: ReceiverRouteContext, api: DomainApi, capability: TargetCapability) {
      const targetId = receiverAttachedTargetIdSchema.optional().safeParse(request.headers[receiverTargetIdHeader]);
      const target = targetId.success ? context.resolveTarget(targetId.data) : null;
      if (!target) return Result.err(failure(404, 'receiver.target.not-found'));
      if (!target.capabilities.includes(capability)) return Result.err(unsupported);

      return Result.ok({ targetId: target.targetId, implementation: (target.attached ? attached : host).get(api.namespace) });
   }

   return [...apis.values()].flatMap((api) => [
      ...defineProcedureRoutes(api, resolve),
      ...defineUploadRoutes(api, resolve),
      ...defineDownloadRoutes(api, resolve)
   ]);
}

type Resolve = (
   request: IncomingMessage,
   context: ReceiverRouteContext,
   api: DomainApi,
   capability: TargetCapability
) => Result<{ targetId: string; implementation: ApiImplementation | undefined }, HttpFailure>;

function defineProcedureRoutes(api: DomainApi, resolve: Resolve) {
   return Object.entries(api.procedures).map(
      ([method, procedure]): Route => ({
         method: 'POST',
         path: receiverProcedurePath(api.namespace, method),
         authenticated: true,
         handle: async (request, response, context) => {
            const target = resolve(request, context, api, procedure.capability);
            if (Result.isError(target)) return writeError(response, target.error);
            const handler = target.value.implementation?.procedures.get(method);
            if (!handler) return writeError(response, unsupported);

            const body = procedure.input ? await readJsonBody(request) : Result.ok({});
            if (Result.isError(body)) return writeError(response, body.error);

            const parsed = procedure.input ? procedure.input.safeParse(body.value) : { success: true, data: {} };
            if (!parsed.success) return writeError(response, failure(400, 'receiver.rpc.invalid-request'));
            const input = apiInputSchema.parse(parsed.data);
            if (!namesServedTargets(input, context)) return writeError(response, nestedTargetNotFound);

            const value = await handler(target.value.targetId, input);
            writeJson(response, 200, { protocolVersion: receiverProtocolVersion, value });
         }
      })
   );
}

function defineUploadRoutes(api: DomainApi, resolve: Resolve) {
   return Object.entries(api.uploads ?? {}).map(
      ([method, upload]): Route => ({
         method: 'POST',
         path: receiverUploadPath(api.namespace, method),
         authenticated: true,
         handle: async (request, response, context) => {
            const target = resolve(request, context, api, upload.capability);
            if (Result.isError(target)) return writeError(response, target.error);
            const handler = target.value.implementation?.uploads.get(method);
            if (!handler) return writeError(response, unsupported);

            const encoded = new URL(request.url ?? '/', 'https://receiver.local').searchParams.get('input');
            const input = Result.try({
               try: () => apiInputSchema.parse(upload.input.parse(JSON.parse(encoded ?? ''))),
               catch: () => failure(400, 'receiver.upload.invalid-request')
            });
            if (Result.isError(input)) return writeError(response, input.error);
            if (!namesServedTargets(input.value, context)) return writeError(response, nestedTargetNotFound);

            const uploaded = await handler(target.value.targetId, input.value, request);
            if (Result.isError(uploaded)) return writeError(response, serviceFailure(uploaded.error));

            writeJson(response, 200, { protocolVersion: receiverProtocolVersion });
         }
      })
   );
}

function defineDownloadRoutes(api: DomainApi, resolve: Resolve) {
   return Object.entries(api.downloads ?? {}).map(
      ([method, download]): Route => ({
         method: 'POST',
         path: receiverDownloadPath(api.namespace, method),
         authenticated: true,
         handle: async (request, response, context) => {
            const target = resolve(request, context, api, download.capability);
            if (Result.isError(target)) return writeError(response, target.error);
            const handler = target.value.implementation?.downloads.get(method);
            if (!handler) return writeError(response, unsupported);

            const body = await readJsonBody(request);
            if (Result.isError(body)) return writeError(response, body.error);
            const parsed = download.input.safeParse(body.value);
            if (!parsed.success) return writeError(response, failure(400, 'receiver.download.invalid-request'));
            const input = apiInputSchema.parse(parsed.data);
            if (!namesServedTargets(input, context)) return writeError(response, nestedTargetNotFound);

            const opened = await handler(target.value.targetId, input);
            if (Result.isError(opened)) return writeError(response, serviceFailure(opened.error));

            response.writeHead(200, { 'content-type': 'application/octet-stream' });
            await Result.tryPromise(() => pipeline(Readable.from(opened.value), response));
         }
      })
   );
}

function namesServedTargets(value: IpcTransportValue, context: ReceiverRouteContext): boolean {
   const container = nestedValuesSchema.safeParse(value);
   if (!container.success) return true;

   return Object.entries(container.data).every(([key, nested]) => {
      if (!/^targetId$|TargetId$/.test(key)) return namesServedTargets(nested, context);
      const targetId = z.string().safeParse(nested);
      return targetId.success && context.servesTarget(targetId.data);
   });
}

const nestedValuesSchema = z.union([z.array(ipcTransportValueSchema), z.record(z.string(), ipcTransportValueSchema)]);

function failure(status: number, code: ProblemCode): HttpFailure {
   return { status, ...createProblem(code) };
}

function serviceFailure({ kind, code, message }: TargetUploadFailure): HttpFailure {
   return { status: kind === 'not-found' ? 404 : kind === 'unavailable' ? 500 : 400, code, message };
}
