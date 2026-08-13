import { z, type ZodType } from 'zod';

export type IpcSerializable = string | number | boolean | null | readonly IpcSerializable[] | { readonly [key: string]: IpcSerializable | undefined };
export type IpcTransportValue = IpcSerializable | undefined;
const ipcSerializableSchema: ZodType<IpcSerializable> = z.lazy(() =>
   z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(ipcSerializableSchema),
      z.record(z.string(), z.union([ipcSerializableSchema, z.undefined()]))
   ])
);
export const ipcTransportValueSchema: ZodType<IpcTransportValue> = z.union([ipcSerializableSchema, z.undefined()]);

export const ipcInvalidRequestCode = 'ipc.invalid-request';

export type IpcError = {
   code: string;
   message: string;
   details?: IpcSerializable;
};

export type IpcResult<Value = IpcSerializable> =
   | {
        ok: true;
        value: Value;
     }
   | {
        ok: false;
        error: IpcError;
     };

export type IpcFailureResult = Extract<IpcResult, { ok: false }>;

export type IpcRequestDefinition<
   Response = unknown,
   Request = unknown,
   Kind extends 'command' | 'procedure' | 'query' = 'command' | 'procedure' | 'query'
> = {
   kind: Kind;
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

export type IpcDefinition = IpcRequestDefinition | AnyIpcEventDefinition;
export type IpcDescriptor = Record<string, IpcDefinition>;

export type IpcRequest<Definition extends IpcRequestDefinition> = Definition extends { request?: infer Request } ? Request : void;

export type IpcResponse<Definition extends IpcRequestDefinition> = Definition extends { response?: infer Response } ? Response : void;

export type IpcEventPayload<Definition extends AnyIpcEventDefinition> = Definition extends { payload?: infer Payload } ? Payload : void;

export type IpcInvokeArgs<Definition extends IpcRequestDefinition> = IpcRequest<Definition> extends void ? [] : [request: IpcRequest<Definition>];

export type IpcEventArgs<Definition extends AnyIpcEventDefinition> =
   IpcEventPayload<Definition> extends void ? [] : [payload: IpcEventPayload<Definition>];

type IpcRequestSchemaArgs<Request> = [Request] extends [void] ? [] : [requestSchema: ZodType<Request>];

export function defineIpcCommand<Response = void, Request = void>(
   channel: string,
   ...[requestSchema]: IpcRequestSchemaArgs<Request>
): IpcRequestDefinition<Response, Request, 'command'> {
   return {
      kind: 'command',
      channel,
      requestSchema
   };
}

export function defineIpcQuery<Response = void, Request = void>(
   channel: string,
   ...[requestSchema]: IpcRequestSchemaArgs<Request>
): IpcRequestDefinition<Response, Request, 'query'> {
   return {
      kind: 'query',
      channel,
      requestSchema
   };
}

export function defineIpcEvent<Payload = void>(channel: string): IpcEventDefinition<Payload> {
   return {
      kind: 'event',
      channel
   };
}

export function defineIpcDescriptor<const Descriptor extends IpcDescriptor>(descriptor: Descriptor) {
   return descriptor;
}
