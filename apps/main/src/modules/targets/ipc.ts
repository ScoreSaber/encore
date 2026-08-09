import { z } from 'zod';

import { defineIpcDescriptor, defineIpcEvent, defineIpcQuery } from '@/ipc/core';
import { installIdSchema } from '@/modules/installs/contract';
import { receiverOperations } from '@/modules/receiver/operations';
import { targetIdSchema, type Target, type TargetEvent, type TargetHealth } from '@/modules/targets/contract';

export const targetIdRequestSchema = z.object({
   targetId: targetIdSchema
});

export const targetInstallRequestSchema = targetIdRequestSchema.extend({
   installId: installIdSchema
});

export type TargetIdRequest = z.infer<typeof targetIdRequestSchema>;

export const targetsIpc = defineIpcDescriptor({
   list: defineIpcQuery<Target[]>('targets:list'),
   getHealth: defineIpcQuery<TargetHealth | null, TargetIdRequest>(receiverOperations.capabilities.id, targetIdRequestSchema),
   onEvent: defineIpcEvent<TargetEvent>('targets:changed')
});
