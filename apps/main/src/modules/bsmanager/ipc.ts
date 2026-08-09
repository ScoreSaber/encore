import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcQuery } from '@/ipc/core';
import type {
   BSManagerAdoptRequest,
   BSManagerAdoptResult,
   BSManagerCleanupRequest,
   BSManagerCleanupResult,
   BSManagerDetectRequest,
   BSManagerDetection,
   BSManagerPlan,
   BSManagerPlanRequest
} from '@/modules/bsmanager/contract';
import { targetIdRequestSchema } from '@/modules/targets/ipc';

const bsmanagerAdoptRequestSchema = targetIdRequestSchema.extend({
   rootPath: z.string().min(1),
   versionIds: z.array(z.string().min(1)),
   adoptSharedRoot: z.boolean()
});

const bsmanagerCleanupRequestSchema = targetIdRequestSchema.extend({
   rootPath: z.string().min(1)
});

export const bsmanagerIpc = defineIpcDescriptor({
   detectBSManager: defineIpcQuery<BSManagerDetection, BSManagerDetectRequest>('bsmanager:detect', targetIdRequestSchema),
   planBSManagerAdoption: defineIpcCommand<BSManagerPlan, BSManagerPlanRequest>('bsmanager:plan', targetIdRequestSchema),
   adoptBSManager: defineIpcCommand<BSManagerAdoptResult, BSManagerAdoptRequest>('bsmanager:adopt', bsmanagerAdoptRequestSchema),
   cleanupBSManagerSharedContent: defineIpcCommand<BSManagerCleanupResult, BSManagerCleanupRequest>(
      'bsmanager:cleanup',
      bsmanagerCleanupRequestSchema
   )
});
