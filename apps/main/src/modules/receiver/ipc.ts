import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/ipc/core';
import type {
   ReceiverActionResult,
   ReceiverDeviceRequest,
   ReceiverPairingResult,
   ReceiverRemoteForgetResult,
   ReceiverRemotePairRequest,
   ReceiverRemotePairResult,
   ReceiverRenameDeviceRequest,
   ReceiverState
} from '@/modules/receiver/contract';
import { receiverDeviceNameSchema, receiverPairingCodeSchema } from '@/modules/receiver/protocol';
import { targetIdRequestSchema, type TargetIdRequest } from '@/modules/targets/ipc';

export type ReceiverInterfaceRequest = {
   interfaceName: string | null;
};

const receiverDeviceRequestSchema = z.object({
   deviceId: z.string().min(1)
});

const receiverRenameDeviceRequestSchema = receiverDeviceRequestSchema.extend({
   name: receiverDeviceNameSchema
});

const receiverInterfaceRequestSchema = z.object({
   interfaceName: z.string().min(1).nullable()
});

const receiverRemotePairRequestSchema = z.object({
   host: z.string().trim().min(1),
   pairingCode: receiverPairingCodeSchema,
   deviceName: receiverDeviceNameSchema
});

export const receiverIpc = defineIpcDescriptor({
   getState: defineIpcQuery<ReceiverState>('receiver:state'),

   startPairing: defineIpcCommand<ReceiverPairingResult>('receiver:start-pairing'),
   revokeDevice: defineIpcCommand<ReceiverActionResult, ReceiverDeviceRequest>('receiver:revoke-device', receiverDeviceRequestSchema),
   renameDevice: defineIpcCommand<ReceiverActionResult, ReceiverRenameDeviceRequest>('receiver:rename-device', receiverRenameDeviceRequestSchema),
   selectInterface: defineIpcCommand<ReceiverActionResult, ReceiverInterfaceRequest>('receiver:select-interface', receiverInterfaceRequestSchema),
   pairRemote: defineIpcCommand<ReceiverRemotePairResult, ReceiverRemotePairRequest>('receiver:remote-pair', receiverRemotePairRequestSchema),
   forgetRemote: defineIpcCommand<ReceiverRemoteForgetResult, TargetIdRequest>('receiver:remote-forget', targetIdRequestSchema),

   onStateChanged: defineIpcEvent<ReceiverState>('receiver:state-changed')
});
