import { BrowserWindow } from 'electron';

import { defineIpcMainCommand, defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import type { ReceiverServerController, RemoteReceiverClient } from '@/main/receiver';
import {
   receiverIpcModule,
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

export function createReceiverIpcModule(receiver: ReceiverServerController, remoteReceiver: RemoteReceiverClient) {
   receiver.subscribe((state) => {
      for (const window of BrowserWindow.getAllWindows()) {
         if (window.isDestroyed()) continue;

         window.webContents.send(receiverStateChangedEvent.channel, state);
      }
   });
   remoteReceiver.subscribe((event) => {
      for (const window of BrowserWindow.getAllWindows()) {
         if (window.isDestroyed()) continue;

         window.webContents.send(receiverRemoteTargetChangedEvent.channel, event);
      }
   });

   return defineIpcMainModule(receiverIpcModule, [
      defineIpcMainQuery(receiverStateQuery, () => receiver.getState()),
      defineIpcMainCommand(receiverStartPairingCommand, () => receiver.startPairing()),
      defineIpcMainCommand(receiverRevokeDeviceCommand, (_event, request) => receiver.revokeDevice(request.deviceId)),
      defineIpcMainCommand(receiverRenameDeviceCommand, (_event, request) => receiver.renameDevice(request.deviceId, request.name)),
      defineIpcMainQuery(receiverRemoteTargetsQuery, () => remoteReceiver.listTargets()),
      defineIpcMainQuery(receiverRemoteTargetInstallsQuery, (_event, request) => remoteReceiver.listInstalls(request.targetId)),
      defineIpcMainQuery(receiverRemoteTargetHealthQuery, (_event, request) => remoteReceiver.getHealth(request.targetId)),
      defineIpcMainCommand(receiverRemotePairCommand, (_event, request) => remoteReceiver.pair(request)),
      defineIpcMainCommand(receiverRemoteDisconnectCommand, (_event, request) => remoteReceiver.disconnect(request.targetId))
   ]);
}
