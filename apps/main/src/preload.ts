import { contextBridge, ipcRenderer } from 'electron';

import { createEncoreApi } from '@/ipc/api';
import { ipcTransportValueSchema, type IpcTransportValue } from '@/ipc/core';

contextBridge.exposeInMainWorld(
   'encore',
   createEncoreApi(
      process.platform,
      async (channel, ...args) => ipcTransportValueSchema.parse(await ipcRenderer.invoke(channel, ...args)),
      (channel, listener) => {
         const handler = (_event: Electron.IpcRendererEvent, payload: IpcTransportValue) => listener(ipcTransportValueSchema.parse(payload));
         ipcRenderer.on(channel, handler);
         return () => ipcRenderer.removeListener(channel, handler);
      }
   )
);
