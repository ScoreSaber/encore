import { Result } from 'better-result';
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { AnyIpcEventDefinition, IpcEventArgs, IpcTransportValue } from '@/ipc/core';
import { createIpcRouter, type IpcModule } from '@/ipc/host';

const ipcEventWindows = new Set<BrowserWindow>();

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

export function registerIpcModules(modules: readonly IpcModule<IpcMainInvokeEvent>[]) {
   const router = createIpcRouter(modules);
   for (const channel of router.channels) {
      ipcMain.handle(channel, async (event, ...args: IpcTransportValue[]) => {
         const result = await router.invoke(channel, args, event);
         return Result.isOk(result) ? { ok: true, value: result.value } : { ok: false, error: result.error };
      });
   }
}
