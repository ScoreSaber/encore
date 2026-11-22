import { defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import { receiverIpc } from '@/modules/receiver/ipc';
import type { ReceiverServerController } from '@/modules/receiver/main/receiver-server';
import type { RemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';

export function createReceiverIpcModule(receiver: ReceiverServerController, remoteReceiver: RemoteReceiverClient, broadcast: IpcBroadcast) {
   receiver.subscribe((state) => broadcast(receiverIpc.onStateChanged, state));

   return defineIpcHandlers(receiverIpc, {
      getState: () => receiver.getState(),
      startPairing: () => receiver.startPairing(),
      revokeDevice: (request) => receiver.revokeDevice(request.deviceId),
      renameDevice: (request) => receiver.renameDevice(request.deviceId, request.name),
      selectInterface: (request) => receiver.selectInterfaceName(request.interfaceName),
      pairRemote: (request) => remoteReceiver.pair(request),
      forgetRemote: (request) => remoteReceiver.forget(request.targetId)
   });
}
