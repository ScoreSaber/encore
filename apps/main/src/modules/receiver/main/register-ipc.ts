import { broadcastIpcEvent, defineIpcHandlers } from '@/ipc/main';
import { receiverIpc } from '@/modules/receiver/ipc';
import type { ReceiverServerController } from '@/modules/receiver/main/receiver-server';
import type { RemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';

export function createReceiverIpcModule(receiver: ReceiverServerController, remoteReceiver: RemoteReceiverClient) {
   receiver.subscribe((state) => broadcastIpcEvent(receiverIpc.onStateChanged, state));

   return defineIpcHandlers(receiverIpc, {
      getState: () => receiver.getState(),
      startPairing: () => receiver.startPairing(),
      revokeDevice: (_event, request) => receiver.revokeDevice(request.deviceId),
      renameDevice: (_event, request) => receiver.renameDevice(request.deviceId, request.name),
      selectInterface: (_event, request) => receiver.selectInterfaceName(request.interfaceName),
      pairRemote: (_event, request) => remoteReceiver.pair(request),
      forgetRemote: (_event, request) => remoteReceiver.forget(request.targetId)
   });
}
