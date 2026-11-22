import { z } from 'zod';

import { defineIpc, request, event } from '@/ipc/core';
import {
   modSourceResolutionSettingsSchema,
   type ModFundingResult,
   type ModImportChoice,
   type ModOperationResult,
   type ModRepositoriesSnapshot,
   type ModRepositoryLinkEvent,
   type ModRepositoryPreview,
   type ModRepositoryResult
} from '@/modules/mods/contract';
import { targetInstallRequestSchema } from '@/modules/targets/contract';

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

export const modsIpc = defineIpc('mods', {
   chooseImportSource: request(targetInstallRequestSchema).returns<ModImportChoice>(),
   import: request(modImportRequestSchema).returns<ModOperationResult>(),
   getFunding: request(modUrlRequestSchema).returns<ModFundingResult>(),

   getRepositories: request().returns<ModRepositoriesSnapshot>(),
   onRepositoryLinkOpened: event<ModRepositoryLinkEvent>(),
   takePendingRepositoryLink: request().returns<ModRepositoryLinkEvent | null>(),
   refreshRepositories: request().returns<ModRepositoriesSnapshot>(),
   previewRepository: request(modUrlRequestSchema).returns<ModRepositoryPreview>(),
   addRepository: request(modRepositoryAddRequestSchema).returns<ModRepositoryResult>(),
   setRepositoryEnabled: request(modRepositoryToggleRequestSchema).returns<ModRepositoryResult>(),
   setModSourceResolution: request(modSourceResolutionSettingsSchema).returns<ModRepositoryResult>(),
   removeRepository: request(modRepositoryIdRequestSchema).returns<ModRepositoryResult>()
});
