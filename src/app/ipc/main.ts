import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
   ipcInvalidRequestCode,
   type AnyIpcEventDefinition,
   type IpcDescriptor,
   type IpcEventArgs,
   type IpcInvokeArgs,
   type IpcRequestDefinition,
   type IpcResponse
} from '@/app/ipc/core';

const ipcEventWindows = new Set<BrowserWindow>();

type IpcMainHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

type IpcMainHandlers<Descriptor extends IpcDescriptor> = {
   [Method in keyof Descriptor as Descriptor[Method] extends IpcRequestDefinition ? Method : never]: Descriptor[Method] extends IpcRequestDefinition
      ? (
           event: IpcMainInvokeEvent,
           ...args: IpcInvokeArgs<Descriptor[Method]>
        ) => IpcResponse<Descriptor[Method]> | Promise<IpcResponse<Descriptor[Method]>>
      : never;
};

export type IpcMainModule = readonly [definition: IpcRequestDefinition, handler: IpcMainHandler][];

export function defineIpcHandlers<Descriptor extends IpcDescriptor>(descriptor: Descriptor, handlers: IpcMainHandlers<Descriptor>): IpcMainModule {
   // object iteration erases descriptor keys and handler signatures; keep that erasure here
   return Object.entries(handlers).map(([method, handler]) => [descriptor[method], handler]) as IpcMainModule;
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

      return handle(event, parsed.data);
   };
}

export function registerIpcModules(modules: readonly IpcMainModule[]) {
   for (const module of modules) {
      for (const [definition, handle] of module) {
         ipcMain.handle(definition.channel, guardRequest(definition, handle));
      }
   }
}
