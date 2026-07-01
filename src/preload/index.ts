import { contextBridge, ipcRenderer } from 'electron';

import { IpcChannel, type AppInfo, type EncoreApi, type UpdateSnapshot } from '@/shared/ipc/contracts';

const encoreApi = {
   platform: process.platform,
   app: {
      getInfo: () => ipcRenderer.invoke(IpcChannel.AppInfo) as Promise<AppInfo>,
      getUpdate: () => ipcRenderer.invoke(IpcChannel.UpdateInfo) as Promise<UpdateSnapshot>,
      checkForUpdates: () => ipcRenderer.invoke(IpcChannel.UpdateCheck) as Promise<UpdateSnapshot>,
      installUpdate: () => ipcRenderer.invoke(IpcChannel.UpdateInstall) as Promise<UpdateSnapshot>,
      onUpdateStatus: (listener: (update: UpdateSnapshot) => void) => {
         const handler = (_event: Electron.IpcRendererEvent, update: UpdateSnapshot) => {
            listener(update);
         };

         ipcRenderer.on(IpcChannel.UpdateStatus, handler);
         return () => {
            ipcRenderer.removeListener(IpcChannel.UpdateStatus, handler);
         };
      }
   }
} satisfies EncoreApi;

contextBridge.exposeInMainWorld('encore', encoreApi);
