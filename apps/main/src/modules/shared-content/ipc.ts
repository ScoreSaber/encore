import { z } from 'zod';

import { defineIpc, request, type OpenFolderResult } from '@/ipc/core';
import { sharedFolderIdSchema } from '@/modules/shared-content/contract';
import { targetIdRequestSchema, targetInstallRequestSchema } from '@/modules/targets/contract';

const sharedFolderRequestSchema = targetInstallRequestSchema.extend({
   folderId: sharedFolderIdSchema
});

const sharedRootRequestSchema = targetIdRequestSchema.extend({
   path: z.string().trim().min(1)
});

export const sharedContentIpc = defineIpc('sharedContent', {
   openSharedFolder: request(sharedFolderRequestSchema).returns<OpenFolderResult>(),
   openSharedRoot: request(sharedRootRequestSchema).returns<OpenFolderResult>()
});
