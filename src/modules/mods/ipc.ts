import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/app/ipc/core';
import type { TargetModRequest } from '@/modules/mods/api';
import {
   type ModImportRequest,
   type ModImportChoice,
   type ModFundingResult,
   type ModLinkRequest,
   type ModOperationResult
} from '@/modules/mods/contract';
import type {
   ModRepositoriesSnapshot,
   ModRepositoryAddRequest,
   ModRepositoryIdRequest,
   ModRepositoryLinkEvent,
   ModRepositoryPreview,
   ModRepositoryResult,
   ModRepositoryToggleRequest,
   ModSourceResolutionRequest
} from '@/modules/mods/contract';
import { modSourceResolutionSettingsSchema } from '@/modules/mods/contract';
import type { TargetRequest } from '@/modules/targets/contract';
import { targetInstallRequestSchema } from '@/modules/targets/ipc';

const modImportRequestSchema = targetInstallRequestSchema.extend({
   sourcePath: z.string().min(1),
   uploadId: z.string().min(1).optional()
});

const modUrlRequestSchema = z.object({
   url: z.string().min(1)
});

const modRepositoryAddRequestSchema = modUrlRequestSchema.extend({
   acknowledged: z.boolean()
});

const modRepositoryIdRequestSchema = z.object({
   id: z.string().min(1)
});

const modRepositoryToggleRequestSchema = modRepositoryIdRequestSchema.extend({
   enabled: z.boolean()
});

export const modsIpc = defineIpcDescriptor({
   chooseImportSource: defineIpcCommand<ModImportChoice, TargetModRequest>('mods:choose-import-source', targetInstallRequestSchema),
   import: defineIpcCommand<ModOperationResult, TargetRequest<ModImportRequest>>('mods:import', modImportRequestSchema),
   getFunding: defineIpcQuery<ModFundingResult, ModLinkRequest>('mods:funding', modUrlRequestSchema),

   getRepositories: defineIpcQuery<ModRepositoriesSnapshot>('mods:repositories'),
   onRepositoryLinkOpened: defineIpcEvent<ModRepositoryLinkEvent>('mods:repositories:link-opened'),
   takePendingRepositoryLink: defineIpcCommand<ModRepositoryLinkEvent | null>('mods:repositories:take-pending-link'),
   refreshRepositories: defineIpcCommand<ModRepositoriesSnapshot>('mods:repositories:refresh'),
   previewRepository: defineIpcCommand<ModRepositoryPreview, { url: string }>('mods:repositories:preview', modUrlRequestSchema),
   addRepository: defineIpcCommand<ModRepositoryResult, ModRepositoryAddRequest>('mods:repositories:add', modRepositoryAddRequestSchema),
   setRepositoryEnabled: defineIpcCommand<ModRepositoryResult, ModRepositoryToggleRequest>(
      'mods:repositories:set-enabled',
      modRepositoryToggleRequestSchema
   ),
   setModSourceResolution: defineIpcCommand<ModRepositoryResult, ModSourceResolutionRequest>(
      'mods:repositories:set-resolution',
      modSourceResolutionSettingsSchema
   ),
   removeRepository: defineIpcCommand<ModRepositoryResult, ModRepositoryIdRequest>('mods:repositories:remove', modRepositoryIdRequestSchema)
});
