export type IpcSerializable = string | number | boolean | null | readonly IpcSerializable[] | { readonly [key: string]: IpcSerializable | undefined };

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

export type IpcCommandDefinition<Channel extends string = string, Response = void, Request = void> = {
   kind: 'command';
   channel: Channel;
   request?: Request;
   response?: Response;
};

export type IpcQueryDefinition<Channel extends string = string, Response = void, Request = void> = {
   kind: 'query';
   channel: Channel;
   request?: Request;
   response?: Response;
};

export type IpcEventDefinition<Channel extends string = string, Payload = void> = {
   kind: 'event';
   channel: Channel;
   payload?: Payload;
};

export type AnyIpcCommandDefinition = IpcCommandDefinition<string, unknown, unknown>;
export type AnyIpcQueryDefinition = IpcQueryDefinition<string, unknown, unknown>;
export type AnyIpcEventDefinition = IpcEventDefinition<string, unknown>;

export type IpcModuleDefinition<
   Name extends string = string,
   Commands extends readonly AnyIpcCommandDefinition[] = readonly AnyIpcCommandDefinition[],
   Queries extends readonly AnyIpcQueryDefinition[] = readonly AnyIpcQueryDefinition[],
   Events extends readonly AnyIpcEventDefinition[] = readonly AnyIpcEventDefinition[]
> = {
   name: Name;
   commands: Commands;
   queries: Queries;
   events: Events;
};

export type IpcRequestDefinition = AnyIpcCommandDefinition | AnyIpcQueryDefinition;

export type IpcRequest<Definition extends IpcRequestDefinition> = Definition extends { request?: infer Request } ? Request : void;

export type IpcResponse<Definition extends IpcRequestDefinition> = Definition extends { response?: infer Response } ? Response : void;

export type IpcEventPayload<Definition extends IpcEventDefinition> = Definition extends { payload?: infer Payload } ? Payload : void;

export type IpcInvokeArgs<Definition extends IpcRequestDefinition> = IpcRequest<Definition> extends void ? [] : [request: IpcRequest<Definition>];

export type IpcEventArgs<Definition extends IpcEventDefinition> =
   IpcEventPayload<Definition> extends void ? [] : [payload: IpcEventPayload<Definition>];

export function defineIpcCommand<Channel extends string, Response = void, Request = void>(
   channel: Channel
): IpcCommandDefinition<Channel, Response, Request> {
   return {
      kind: 'command',
      channel
   };
}

export function defineIpcQuery<Channel extends string, Response = void, Request = void>(
   channel: Channel
): IpcQueryDefinition<Channel, Response, Request> {
   return {
      kind: 'query',
      channel
   };
}

export function defineIpcEvent<Channel extends string, Payload = void>(channel: Channel): IpcEventDefinition<Channel, Payload> {
   return {
      kind: 'event',
      channel
   };
}

export function defineIpcModule<const Module extends IpcModuleDefinition>(module: Module) {
   return module;
}
