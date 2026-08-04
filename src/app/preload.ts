import { contextBridge, ipcRenderer } from 'electron';

import { createEncoreApi } from '@/app/ipc/api';

contextBridge.exposeInMainWorld(
   'encore',
   createEncoreApi(
      process.platform,
      (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      (channel, listener) => {
         const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
         ipcRenderer.on(channel, handler);
         return () => ipcRenderer.removeListener(channel, handler);
      }
   )
);
