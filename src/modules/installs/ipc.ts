import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand } from '@/app/ipc/core';
import {
   type InstallActionRequest,
   type InstallImportChoice,
   type InstallImportRequest,
   type InstallImportResult,
   type InstallLocationChoice,
   type InstallOpenFolderResult
} from '@/modules/installs/contract';
import { targetIdRequestSchema, targetInstallRequestSchema, type TargetIdRequest } from '@/modules/targets/ipc';

const installImportRequestSchema = targetIdRequestSchema.extend({
   sourcePath: z.string().min(1)
});

export const installsIpc = defineIpcDescriptor({
   chooseImportSource: defineIpcCommand<InstallImportChoice, TargetIdRequest>('installs:choose-import-source', targetIdRequestSchema),
   chooseInstallLocation: defineIpcCommand<InstallLocationChoice, InstallActionRequest>(
      'installs:choose-install-location',
      targetInstallRequestSchema
   ),
   import: defineIpcCommand<InstallImportResult, InstallImportRequest>('installs:import', installImportRequestSchema),
   openFolder: defineIpcCommand<InstallOpenFolderResult, InstallActionRequest>('installs:open-folder', targetInstallRequestSchema)
});
