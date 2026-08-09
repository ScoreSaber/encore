import { Result } from 'better-result';
import type { z } from 'zod';

import {
   checkProtocolVersion,
   readBearerToken,
   readJsonBody,
   unauthorizedFailure,
   writeError,
   writeJson
} from '@/modules/receiver/main/receiver-http';
import type { ReceiverRouteContext } from '@/modules/receiver/main/receiver-server';
import { receiverOperations, type ReceiverOperationDefinition, type ReceiverRequestOperation } from '@/modules/receiver/operations';
import { receiverProtocolVersion } from '@/modules/receiver/protocol';

import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteHandler = (request: IncomingMessage, response: ServerResponse, context: ReceiverRouteContext) => Promise<void> | void;

export type Route = {
   method: 'GET' | 'POST';
   path: string;
   authenticated: boolean;
   handle: RouteHandler;
};

export type ReceiverResponsePayload<Schema extends z.ZodType<object>> = Omit<z.output<Schema>, 'protocolVersion'>;

export async function readReceiverRequest<Schema extends z.ZodType>(
   request: IncomingMessage,
   operation: {
      request: Schema;
      invalidRequest: { code: string; message: string };
   }
) {
   const body = await readJsonBody(request);
   if (Result.isError(body)) return Result.err(body.error);

   const parsed = operation.request.safeParse(body.value);
   if (!parsed.success) {
      return Result.err({
         status: 400,
         ...operation.invalidRequest
      });
   }

   return Result.ok(parsed.data);
}

export function writeReceiverResponse<ResponseSchema extends z.ZodType<object>>(
   response: ServerResponse,
   _operation: ReceiverOperationDefinition & { response: ResponseSchema },
   payload: ReceiverResponsePayload<ResponseSchema>
) {
   writeJson(response, 200, {
      protocolVersion: receiverProtocolVersion,
      ...payload
   });
}

export function receiverRoute<ResponseSchema extends z.ZodType<object>>(
   operation: ReceiverOperationDefinition & {
      request?: undefined;
      response: ResponseSchema;
   },
   handle: (context: ReceiverRouteContext) => ReceiverResponsePayload<ResponseSchema> | Promise<ReceiverResponsePayload<ResponseSchema>>
): Route {
   return {
      method: operation.method,
      path: operation.path,
      authenticated: operation.authenticated,
      handle: async (_request, response, context) => {
         writeReceiverResponse(response, operation, await handle(context));
      }
   };
}

export function receiverRequestRoute<RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType<object>>(
   operation: ReceiverRequestOperation & {
      request: RequestSchema;
      response: ResponseSchema;
   },
   handle: (
      input: z.output<RequestSchema>,
      context: ReceiverRouteContext,
      request: IncomingMessage
   ) => ReceiverResponsePayload<ResponseSchema> | Promise<ReceiverResponsePayload<ResponseSchema>>
): Route {
   return {
      method: operation.method,
      path: operation.path,
      authenticated: operation.authenticated,
      handle: async (request, response, context) => {
         const input = await readReceiverRequest(request, operation);
         if (Result.isError(input)) return writeError(response, input.error);

         writeReceiverResponse(response, operation, await handle(input.value, context, request));
      }
   };
}

export function createReceiverRequestHandler(routes: Route[]) {
   return async function handleReceiverRequest(request: IncomingMessage, response: ServerResponse, context: ReceiverRouteContext) {
      const path = new URL(request.url ?? '/', `https://${request.headers.host ?? 'receiver.local'}`).pathname;

      const protocolFailure = checkProtocolVersion(request, path);
      if (protocolFailure) return writeError(response, protocolFailure);

      if (request.method === receiverOperations.events.method && path === receiverOperations.events.path) {
         const device = await authenticateRequest(request, response, context);
         if (!device || response.destroyed || response.writableEnded) return;

         context.events.attach(response, device.id, [{ type: 'target', target: context.getTarget() }]);
         return;
      }

      const route = routes.find((candidate) => candidate.path === path && candidate.method === request.method);
      if (!route) {
         return writeError(response, {
            status: 404,
            code: 'receiver.route.not-found',
            message: 'Route was not found'
         });
      }

      if (route.authenticated && !(await authenticateRequest(request, response, context))) return;

      await route.handle(request, response, context);
   };
}

async function authenticateRequest(request: IncomingMessage, response: ServerResponse, context: ReceiverRouteContext) {
   const token = readBearerToken(request);
   const device = token ? await context.pairing.authenticate(token) : null;

   if (!device) {
      writeError(response, unauthorizedFailure());
      return null;
   }

   return device;
}
