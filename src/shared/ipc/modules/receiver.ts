import { defineIpcCommand, defineIpcEvent, defineIpcModule, defineIpcQuery } from '@/shared/ipc/core';
import type {
   ReceiverActionResult,
   ReceiverDeviceRequest,
   ReceiverPairingResult,
   ReceiverRemoteDisconnectResult,
   ReceiverRemotePairRequest,
   ReceiverRemotePairResult,
   ReceiverRenameDeviceRequest,
   ReceiverState
} from '@/shared/receiver';
import type { InstallSummary, Target, TargetEvent, TargetHealth, TargetId } from '@/shared/targets';

export type ReceiverTargetIdRequest = {
   targetId: TargetId;
};

export const receiverStateQuery = defineIpcQuery<'receiver:state', ReceiverState>('receiver:state');
export const receiverRemoteTargetsQuery = defineIpcQuery<'receiver:remote-targets', Target[]>('receiver:remote-targets');
export const receiverRemoteTargetHealthQuery = defineIpcQuery<'receiver:remote-target-health', TargetHealth | null, ReceiverTargetIdRequest>(
   'receiver:remote-target-health'
);
export const receiverRemoteTargetInstallsQuery = defineIpcQuery<'receiver:remote-target-installs', InstallSummary[], ReceiverTargetIdRequest>(
   'receiver:remote-target-installs'
);

export const receiverStartPairingCommand = defineIpcCommand<'receiver:start-pairing', ReceiverPairingResult>('receiver:start-pairing');
export const receiverRevokeDeviceCommand = defineIpcCommand<'receiver:revoke-device', ReceiverActionResult, ReceiverDeviceRequest>(
   'receiver:revoke-device'
);
export const receiverRenameDeviceCommand = defineIpcCommand<'receiver:rename-device', ReceiverActionResult, ReceiverRenameDeviceRequest>(
   'receiver:rename-device'
);
export const receiverRemotePairCommand = defineIpcCommand<'receiver:remote-pair', ReceiverRemotePairResult, ReceiverRemotePairRequest>(
   'receiver:remote-pair'
);
export const receiverRemoteDisconnectCommand = defineIpcCommand<
   'receiver:remote-disconnect',
   ReceiverRemoteDisconnectResult,
   ReceiverTargetIdRequest
>('receiver:remote-disconnect');

export const receiverStateChangedEvent = defineIpcEvent<'receiver:state-changed', ReceiverState>('receiver:state-changed');
export const receiverRemoteTargetChangedEvent = defineIpcEvent<'receiver:remote-target-changed', TargetEvent>('receiver:remote-target-changed');

export const receiverIpcModule = defineIpcModule({
   name: 'receiver',
   commands: [
      receiverStartPairingCommand,
      receiverRevokeDeviceCommand,
      receiverRenameDeviceCommand,
      receiverRemotePairCommand,
      receiverRemoteDisconnectCommand
   ],
   queries: [receiverStateQuery, receiverRemoteTargetsQuery, receiverRemoteTargetHealthQuery, receiverRemoteTargetInstallsQuery],
   events: [receiverStateChangedEvent, receiverRemoteTargetChangedEvent]
} as const);
