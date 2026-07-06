import { contextBridge, ipcRenderer } from 'electron';

import type { EncoreApi } from '@/shared/ipc/api';
import type { AnyIpcEventDefinition, IpcEventPayload, IpcInvokeArgs, IpcRequestDefinition, IpcResponse } from '@/shared/ipc/core';
import { appInfoQuery } from '@/shared/ipc/modules/app';
import { operationCancelCommand, operationDemoStartCommand, operationListQuery, operationSnapshotEvent } from '@/shared/ipc/modules/operations';
import {
   receiverRemoteDisconnectCommand,
   receiverRemotePairCommand,
   receiverRemoteTargetChangedEvent,
   receiverRemoteTargetHealthQuery,
   receiverRemoteTargetInstallsQuery,
   receiverRemoteTargetsQuery,
   receiverRenameDeviceCommand,
   receiverRevokeDeviceCommand,
   receiverStartPairingCommand,
   receiverStateChangedEvent,
   receiverStateQuery
} from '@/shared/ipc/modules/receiver';
import { settingsSnapshotQuery, settingsUpdateAppCommand, settingsUpdateLibraryCommand } from '@/shared/ipc/modules/settings';
import { targetChangedEvent, targetHealthQuery, targetInstallsQuery, targetListQuery } from '@/shared/ipc/modules/targets';
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
   settings: {
      getSnapshot: () => invokeIpc(settingsSnapshotQuery),
      updateApp: (patch) => invokeIpc(settingsUpdateAppCommand, patch),
      updateLibrary: (patch) => invokeIpc(settingsUpdateLibraryCommand, patch)
   },
   receiver: {
      getState: () => invokeIpc(receiverStateQuery),
      startPairing: () => invokeIpc(receiverStartPairingCommand),
      renameDevice: (request) => invokeIpc(receiverRenameDeviceCommand, request),
      revokeDevice: (request) => invokeIpc(receiverRevokeDeviceCommand, request),
      pairRemote: (request) => invokeIpc(receiverRemotePairCommand, request),
      disconnectRemote: (targetId) => invokeIpc(receiverRemoteDisconnectCommand, { targetId }),
      listRemoteTargets: () => invokeIpc(receiverRemoteTargetsQuery),
      listRemoteInstalls: (targetId) => invokeIpc(receiverRemoteTargetInstallsQuery, { targetId }),
      getRemoteHealth: (targetId) => invokeIpc(receiverRemoteTargetHealthQuery, { targetId }),
      onStateChanged: (listener) => onIpc(receiverStateChangedEvent, listener),
      onRemoteTargetEvent: (listener) => onIpc(receiverRemoteTargetChangedEvent, listener)
   },
   targets: {
      list: () => invokeIpc(targetListQuery),
      listInstalls: (targetId) => invokeIpc(targetInstallsQuery, { targetId }),
      getHealth: (targetId) => invokeIpc(targetHealthQuery, { targetId }),
      onEvent: (listener) => onIpc(targetChangedEvent, listener)
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
