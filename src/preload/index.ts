import { contextBridge, ipcRenderer } from 'electron';

import { IpcChannel, type AppInfo, type EncoreApi } from '@/shared/ipc/contracts';

const encoreApi = {
   platform: process.platform,
   app: {
      getInfo: () => ipcRenderer.invoke(IpcChannel.AppInfo) as Promise<AppInfo>
   }
} satisfies EncoreApi;

contextBridge.exposeInMainWorld('encore', encoreApi);
