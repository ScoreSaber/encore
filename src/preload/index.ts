import { contextBridge, ipcRenderer } from 'electron';

import type { EncoreApi } from '@/shared/ipc/api';
import type { AnyIpcEventDefinition, IpcEventPayload, IpcInvokeArgs, IpcRequestDefinition, IpcResponse } from '@/shared/ipc/core';
import { appInfoQuery } from '@/shared/ipc/modules/app';
import { operationCancelCommand, operationDemoStartCommand, operationListQuery, operationSnapshotEvent } from '@/shared/ipc/modules/operations';
import { updateCheckCommand, updateInfoQuery, updateInstallCommand, updateStatusEvent } from '@/shared/ipc/modules/update';

function invokeIpc<Definition extends IpcRequestDefinition>(definition: Definition, ...args: IpcInvokeArgs<Definition>) {
   return ipcRenderer.invoke(definition.channel, ...args) as Promise<IpcResponse<Definition>>;
}

function onIpc<Definition extends AnyIpcEventDefinition>(definition: Definition, listener: (payload: IpcEventPayload<Definition>) => void) {
   const handler = (_event: Electron.IpcRendererEvent, payload: IpcEventPayload<Definition>) => {
      listener(payload);
   };

   ipcRenderer.on(definition.channel, handler);
   return () => {
      ipcRenderer.removeListener(definition.channel, handler);
   };
}

const encoreApi = {
   platform: process.platform,
   app: {
      getInfo: () => invokeIpc(appInfoQuery)
   },
   update: {
      getSnapshot: () => invokeIpc(updateInfoQuery),
      checkForUpdates: () => invokeIpc(updateCheckCommand),
      installDownloaded: () => invokeIpc(updateInstallCommand),
      onStatus: (listener) => onIpc(updateStatusEvent, listener)
   },
   operations: {
      list: () => invokeIpc(operationListQuery),
      cancel: (id) => invokeIpc(operationCancelCommand, { id }),
      startDemo: (request = {}) => invokeIpc(operationDemoStartCommand, request),
      onSnapshot: (listener) => onIpc(operationSnapshotEvent, listener)
   }
} satisfies EncoreApi;

contextBridge.exposeInMainWorld('encore', encoreApi);
