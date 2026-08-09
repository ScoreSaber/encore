import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand } from '@/ipc/core';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import {
   sharedFolderIdSchema,
   type SharedContentOpenFolderResult,
   type SharedFolderRequest,
   type SharedRootRequest,
   type SharedRootChoice
} from '@/modules/shared-content/contract';
import type { TargetId, TargetRequest } from '@/modules/targets/contract';
import { targetIdRequestSchema, targetInstallRequestSchema } from '@/modules/targets/ipc';

const sharedFolderRequestSchema = targetInstallRequestSchema.extend({
   folderId: sharedFolderIdSchema
});

const sharedRootRequestSchema = targetIdRequestSchema.extend({
   path: z.string().trim().min(1)
});

export const sharedContentIpc = defineIpcDescriptor({
   openSharedFolder: defineIpcCommand<SharedContentOpenFolderResult, TargetSharedContentRequest & SharedFolderRequest>(
      'shared-content:open-folder',
      sharedFolderRequestSchema
   ),
   chooseSharedRoot: defineIpcCommand<SharedRootChoice, { targetId: TargetId }>('shared-content:choose-root', targetIdRequestSchema),
   openSharedRoot: defineIpcCommand<SharedContentOpenFolderResult, TargetRequest<SharedRootRequest>>(
      'shared-content:open-root',
      sharedRootRequestSchema
   )
});
