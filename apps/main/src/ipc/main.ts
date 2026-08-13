import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';

import {
   ipcInvalidRequestCode,
   ipcTransportValueSchema,
   type AnyIpcEventDefinition,
   type IpcDescriptor,
   type IpcEventArgs,
   type IpcInvokeArgs,
   type IpcRequestDefinition,
   type IpcResponse,
   type IpcTransportValue
} from '@/ipc/core';

const ipcEventWindows = new Set<BrowserWindow>();

type IpcMainHandler = (event: IpcMainInvokeEvent, ...args: IpcTransportValue[]) => IpcTransportValue | Promise<IpcTransportValue>;

type IpcMainHandlers<Descriptor extends IpcDescriptor> = {
   [Method in keyof Descriptor as Descriptor[Method] extends IpcRequestDefinition ? Method : never]: Descriptor[Method] extends IpcRequestDefinition
      ? (
           event: IpcMainInvokeEvent,
           ...args: IpcInvokeArgs<Descriptor[Method]>
        ) => IpcResponse<Descriptor[Method]> | Promise<IpcResponse<Descriptor[Method]>>
      : never;
};

export type IpcMainModule = readonly { definition: IpcRequestDefinition; handler: IpcMainHandler }[];

export function defineIpcHandlers<Descriptor extends IpcDescriptor>(descriptor: Descriptor, handlers: IpcMainHandlers<Descriptor>): IpcMainModule {
   const parsedHandlers = z
      .record(z.string(), z.function({ input: z.tuple([z.custom<IpcMainInvokeEvent>()], ipcTransportValueSchema) }))
      .parse(handlers);
   return Object.entries(parsedHandlers).map(([method, handler]) => {
      const definition = descriptor[method];
      if (!definition || definition.kind === 'event') throw new Error(`Unknown IPC handler: ${method}`);

      return {
         definition,
         handler: async (event, ...args) => ipcTransportValueSchema.parse(await handler(event, ...args))
      };
   });
}

export function registerIpcEventWindow(window: BrowserWindow) {
   ipcEventWindows.add(window);
   window.once('closed', () => {
      ipcEventWindows.delete(window);
   });
}

export function broadcastIpcEvent<Definition extends AnyIpcEventDefinition>(definition: Definition, ...args: IpcEventArgs<Definition>) {
   for (const window of ipcEventWindows) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
         ipcEventWindows.delete(window);
         continue;
      }

      window.webContents.send(definition.channel, ...args);
   }
}

function guardRequest(definition: IpcRequestDefinition, handle: IpcMainHandler): IpcMainHandler {
   const schema = definition.requestSchema;
   if (!schema) return handle;

   return (event, request) => {
      const parsed = schema.safeParse(request);
      if (!parsed.success) throw new Error(`${ipcInvalidRequestCode}: ${definition.channel}`);

      return handle(event, ipcTransportValueSchema.parse(parsed.data));
   };
}

export function registerIpcModules(modules: readonly IpcMainModule[]) {
   for (const module of modules) {
      for (const { definition, handler } of module) {
         ipcMain.handle(definition.channel, guardRequest(definition, handler));
      }
   }
}
