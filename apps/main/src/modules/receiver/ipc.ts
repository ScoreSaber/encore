import { z } from 'zod';

import { defineIpc, request, event } from '@/ipc/core';
import type {
   ReceiverActionResult,
   ReceiverPairingResult,
   ReceiverRemoteForgetResult,
   ReceiverRemotePairResult,
   ReceiverState
} from '@/modules/receiver/contract';
import { receiverDeviceNameSchema, receiverPairingCodeSchema } from '@/modules/receiver/protocol';
import { targetIdRequestSchema } from '@/modules/targets/contract';

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

export const receiverIpc = defineIpc('receiver', {
   getState: request().returns<ReceiverState>(),

   startPairing: request().returns<ReceiverPairingResult>(),
   revokeDevice: request(receiverDeviceRequestSchema).returns<ReceiverActionResult>(),
   renameDevice: request(receiverRenameDeviceRequestSchema).returns<ReceiverActionResult>(),
   selectInterface: request(receiverInterfaceRequestSchema).returns<ReceiverActionResult>(),
   pairRemote: request(receiverRemotePairRequestSchema).returns<ReceiverRemotePairResult>(),
   forgetRemote: request(targetIdRequestSchema).returns<ReceiverRemoteForgetResult>(),

   onStateChanged: event<ReceiverState>()
});
