import { Err, Ok, TaggedError, type Result } from 'better-result';
import { z, type ZodType } from 'zod';

import type { Problem } from '@/lib/errors';

type IpcSerializable = string | number | boolean | null | readonly IpcSerializable[] | { readonly [key: string]: IpcSerializable | undefined };
export type IpcTransportValue = IpcSerializable | undefined;
export const ipcTransportValueSchema: ZodType<IpcTransportValue> = z.custom<IpcTransportValue>();

export type OpenFolderResult = { status: 'opened' | 'unsupported' | 'failed' };
export type FileImportChoice = { status: 'selected'; paths: string[] } | { status: 'cancelled' } | { status: 'unsupported' };
export type FileExportChoice = { status: 'selected'; path: string } | { status: 'cancelled' } | { status: 'unsupported' };
export const linkRegistrationSchema = z.object({ registered: z.boolean() });
export type LinkProtocolState = { scheme: string; registered: boolean; canUnregister: boolean };
export type LinkProtocolResult = IpcResult<LinkProtocolState>;

export class IpcInvokeError extends TaggedError('IpcInvokeError')<{ code: string; message: string }>() {}

export type IpcResult<Value = IpcSerializable> =
   | {
        ok: true;
        value: Value;
     }
   | {
        ok: false;
        error: Problem;
     };

export type IpcFailureResult = Extract<IpcResult, { ok: false }>;

export type IpcReturn<Response> = [Response] extends [IpcResult<infer Value>] ? Response | Result<Value, Problem> : Response;

export const ipcHandlerReturnSchema = z.union([
   z
      .custom<Ok<unknown, Problem>>((value) => value instanceof Ok)
      .transform(({ value }) => ({ ok: true, value: ipcTransportValueSchema.parse(value) })),
   z.custom<Err<unknown, Problem>>((value) => value instanceof Err).transform(({ error }) => ({ ok: false, error })),
   ipcTransportValueSchema
]);

export type IpcRequestDefinition<Response = unknown, Request = unknown> = {
   kind: 'request';
   channel: string;
   request?: Request;
   response?: Response;
   requestSchema?: ZodType<Request>;
};

export type IpcEventDefinition<Payload = void> = {
   kind: 'event';
   channel: string;
   payload?: Payload;
};

export type AnyIpcEventDefinition = IpcEventDefinition<unknown>;

type IpcDefinition = IpcRequestDefinition | AnyIpcEventDefinition;
export type IpcDescriptor = Record<string, IpcDefinition>;

export type IpcRequest<Definition extends IpcRequestDefinition> = Definition extends { request?: infer Request } ? Request : void;

export type IpcResponse<Definition extends IpcRequestDefinition> = Definition extends { response?: infer Response } ? Response : void;

export type IpcEventPayload<Definition extends AnyIpcEventDefinition> = Definition extends { payload?: infer Payload } ? Payload : void;

export type IpcInvokeArgs<Definition extends IpcRequestDefinition> = IpcRequest<Definition> extends void ? [] : [request: IpcRequest<Definition>];

export type IpcEventArgs<Definition extends AnyIpcEventDefinition> =
   IpcEventPayload<Definition> extends void ? [] : [payload: IpcEventPayload<Definition>];

type IpcRequestMethod<Response, Request> = Omit<IpcRequestDefinition<Response, Request>, 'channel'>;
type IpcRequestBuilder<Request> = IpcRequestMethod<void, Request> & { returns<Response>(): IpcRequestMethod<Response, Request> };
type IpcMethods = Record<string, IpcRequestMethod<unknown, unknown> | Omit<AnyIpcEventDefinition, 'channel'>>;

export function request(): IpcRequestBuilder<void>;
export function request<Schema extends ZodType>(requestSchema: Schema): IpcRequestBuilder<z.output<Schema>>;
export function request(requestSchema?: ZodType): IpcRequestBuilder<unknown> {
   return { kind: 'request', requestSchema, returns: () => ({ kind: 'request', requestSchema }) };
}

export function event<Payload = void>(): Omit<IpcEventDefinition<Payload>, 'channel'> {
   return { kind: 'event' };
}

export function defineIpc<Methods extends IpcMethods>(
   domain: string,
   methods: Methods
): { [Method in keyof Methods]: Omit<Methods[Method], 'returns'> & { channel: string } };
export function defineIpc(domain: string, methods: IpcMethods) {
   return Object.fromEntries(
      Object.entries(methods).map(([method, definition]) => {
         const channel = `${domain}:${method}`;
         return [
            method,
            definition.kind === 'event' ? { kind: 'event', channel } : { kind: 'request', channel, requestSchema: definition.requestSchema }
         ];
      })
   );
}
