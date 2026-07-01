import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type {
   IpcCommandDefinition,
   IpcInvokeArgs,
   IpcModuleDefinition,
   IpcQueryDefinition,
   IpcRequestDefinition,
   IpcResponse
} from '@/shared/ipc/core';

type IpcMainHandlerResult<Definition extends IpcRequestDefinition> = IpcResponse<Definition> | Promise<IpcResponse<Definition>>;

export type IpcMainRequestHandler<Definition extends IpcRequestDefinition = IpcRequestDefinition> = (
   event: IpcMainInvokeEvent,
   ...args: IpcInvokeArgs<Definition>
) => IpcMainHandlerResult<Definition>;

export type IpcMainRequestHandlerDefinition<Definition extends IpcRequestDefinition = IpcRequestDefinition> = {
   definition: Definition;
   handle: IpcMainRequestHandler<Definition>;
};

export type IpcMainModule<Module extends IpcModuleDefinition = IpcModuleDefinition> = {
   module: Module;
   handlers: readonly IpcMainRequestHandlerDefinition[];
};

type IpcChannelOwner = {
   moduleName: string;
   kind: IpcRequestDefinition['kind'] | 'event';
};

export function defineIpcMainCommand<Definition extends IpcCommandDefinition>(
   definition: Definition,
   handle: IpcMainRequestHandler<Definition>
): IpcMainRequestHandlerDefinition<Definition> {
   return {
      definition,
      handle
   };
}

export function defineIpcMainQuery<Definition extends IpcQueryDefinition>(
   definition: Definition,
   handle: IpcMainRequestHandler<Definition>
): IpcMainRequestHandlerDefinition<Definition> {
   return {
      definition,
      handle
   };
}

export function defineIpcMainModule<const Module extends IpcModuleDefinition>(
   module: Module,
   handlers: readonly IpcMainRequestHandlerDefinition[]
): IpcMainModule<Module> {
   return {
      module,
      handlers
   };
}

export function registerIpcModules(modules: readonly IpcMainModule[]) {
   assertUniqueIpcChannels(modules.map(({ module }) => module));

   for (const moduleDefinition of modules) {
      assertModuleHandlersMatchContract(moduleDefinition);

      for (const handler of moduleDefinition.handlers) {
         const handle = handler.handle as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
         ipcMain.handle(handler.definition.channel, handle);
      }
   }
}

export function assertUniqueIpcChannels(modules: readonly IpcModuleDefinition[]) {
   const channels = new Map<string, IpcChannelOwner>();

   for (const moduleDefinition of modules) {
      for (const definition of moduleDefinition.commands) {
         addUniqueChannel(channels, moduleDefinition.name, definition.kind, definition.channel);
      }

      for (const definition of moduleDefinition.queries) {
         addUniqueChannel(channels, moduleDefinition.name, definition.kind, definition.channel);
      }

      for (const definition of moduleDefinition.events) {
         addUniqueChannel(channels, moduleDefinition.name, definition.kind, definition.channel);
      }
   }
}

function assertModuleHandlersMatchContract(moduleDefinition: IpcMainModule) {
   const contractChannels = new Set([...moduleDefinition.module.commands, ...moduleDefinition.module.queries].map(({ channel }) => channel));
   const handlerChannels = new Set(moduleDefinition.handlers.map(({ definition }) => definition.channel));

   for (const channel of contractChannels) {
      if (!handlerChannels.has(channel)) {
         throw new Error(`Missing IPC handler for "${channel}" in "${moduleDefinition.module.name}"`);
      }
   }

   for (const channel of handlerChannels) {
      if (!contractChannels.has(channel)) {
         throw new Error(`Unexpected IPC handler for "${channel}" in "${moduleDefinition.module.name}"`);
      }
   }
}

function addUniqueChannel(channels: Map<string, IpcChannelOwner>, moduleName: string, kind: IpcChannelOwner['kind'], channel: string) {
   const existing = channels.get(channel);
   if (existing) {
      throw new Error(`Duplicate IPC channel "${channel}" in "${existing.moduleName}" and "${moduleName}"`);
   }

   channels.set(channel, {
      moduleName,
      kind
   });
}
