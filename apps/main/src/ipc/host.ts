import { Result } from 'better-result';
import { z } from 'zod';

import { ipcDescriptors } from '@/ipc/api';
import {
   IpcInvokeError,
   ipcTransportValueSchema,
   ipcHandlerReturnSchema,
   type AnyIpcEventDefinition,
   type IpcDescriptor,
   type IpcEventArgs,
   type IpcRequest,
   type IpcRequestDefinition,
   type IpcResponse,
   type IpcReturn,
   type IpcTransportValue
} from '@/ipc/core';
import { createProblem, type Problem } from '@/lib/errors';

type IpcHandlers<Descriptor extends IpcDescriptor, Context> = {
   [Method in keyof Descriptor as Descriptor[Method] extends IpcRequestDefinition ? Method : never]: Descriptor[Method] extends IpcRequestDefinition
      ? (
           request: IpcRequest<Descriptor[Method]>,
           context: Context
        ) => IpcReturn<IpcResponse<Descriptor[Method]>> | Promise<IpcReturn<IpcResponse<Descriptor[Method]>>>
      : never;
};

export type IpcModule<Context = unknown> = readonly {
   definition: IpcRequestDefinition;
   handle: (request: IpcTransportValue, context: Context) => Promise<IpcTransportValue>;
}[];

export type IpcBroadcast = <Definition extends AnyIpcEventDefinition>(definition: Definition, ...args: IpcEventArgs<Definition>) => void;

const erasedHandlersSchema = z.record(z.string(), z.function({ input: [z.unknown(), z.unknown()] }));

export function defineIpcHandlers<Descriptor extends IpcDescriptor, Context = unknown>(
   descriptor: Descriptor,
   handlers: IpcHandlers<Descriptor, Context>
): IpcModule<Context>;
export function defineIpcHandlers<Descriptor extends IpcDescriptor, Context = unknown>(
   descriptor: Descriptor,
   handlers: Partial<IpcHandlers<Descriptor, Context>>,
   coverage: 'partial'
): IpcModule<Context>;
export function defineIpcHandlers<Descriptor extends IpcDescriptor>(
   descriptor: Descriptor,
   handlers: Partial<IpcHandlers<Descriptor, unknown>>
): IpcModule {
   return Object.entries(erasedHandlersSchema.parse(handlers)).map(([method, handler]) => {
      const definition = descriptor[method];
      if (!definition || definition.kind === 'event') throw new Error(`Unknown IPC handler: ${method}`);

      return { definition, handle: async (request, context) => ipcHandlerReturnSchema.parse(await handler(request, context)) };
   });
}

export function createIpcRouter<Context>(modules: readonly IpcModule<Context>[]) {
   const definitions = new Map<string, IpcRequestDefinition>();
   for (const descriptor of Object.values<IpcDescriptor>(ipcDescriptors)) {
      for (const definition of Object.values(descriptor)) {
         if (definition.kind !== 'event') definitions.set(definition.channel, definition);
      }
   }

   const handlers = new Map<string, IpcModule<Context>[number]['handle']>();
   for (const module of modules) {
      for (const { definition, handle } of module) {
         definitions.set(definition.channel, definition);
         handlers.set(definition.channel, handle);
      }
   }

   async function invoke(channel: string, args: readonly IpcTransportValue[], context: Context): Promise<Result<IpcTransportValue, Problem>> {
      const definition = definitions.get(channel);
      const schema = definition?.requestSchema;
      const request = schema ? schema.safeParse(args[0]) : { success: args[0] === undefined, data: undefined };
      if (!definition || args.length > 1 || !request.success) {
         return Result.err(createProblem('ipc.invalid-request', { detail: channel }));
      }

      const handle = handlers.get(channel);
      if (!handle) return Result.err(createProblem('ipc.unsupported', { detail: channel }));

      return Result.tryPromise({
         try: () => handle(ipcTransportValueSchema.parse(request.data), context),
         catch: (cause): Problem => (IpcInvokeError.is(cause) ? { code: cause.code, message: cause.message } : createProblem('ipc.failed', { cause }))
      });
   }

   return { channels: [...definitions.keys()], invoke };
}
