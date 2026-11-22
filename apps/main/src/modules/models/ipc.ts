import { z } from 'zod';

import {
   defineIpc,
   event,
   linkRegistrationSchema,
   request,
   type FileExportChoice,
   type FileImportChoice,
   type LinkProtocolResult,
   type LinkProtocolState,
   type OpenFolderResult
} from '@/ipc/core';
import type { ModelLinkEvent, ModelOperationResult } from '@/modules/models/contract';
import { targetInstallRequestSchema } from '@/modules/targets/contract';

const modelDetailRequestSchema = targetInstallRequestSchema.extend({
   modelId: z.string().min(1)
});

const modelSelectionRequestSchema = targetInstallRequestSchema.extend({
   modelIds: z.array(z.string().min(1))
});

const modelImportRequestSchema = targetInstallRequestSchema.extend({
   paths: z.array(z.string().min(1))
});

const modelExportRequestSchema = modelSelectionRequestSchema.extend({
   destinationPath: z.string().min(1)
});

export const modelsIpc = defineIpc('models', {
   getModelLinkState: request().returns<LinkProtocolState>(),
   openModelFolder: request(modelDetailRequestSchema).returns<OpenFolderResult>(),
   chooseModelImport: request(targetInstallRequestSchema).returns<FileImportChoice>(),
   importModels: request(modelImportRequestSchema).returns<ModelOperationResult>(),
   chooseModelExport: request(modelSelectionRequestSchema).returns<FileExportChoice>(),
   exportModels: request(modelExportRequestSchema).returns<ModelOperationResult>(),
   setModelLinkRegistered: request(linkRegistrationSchema).returns<LinkProtocolResult>(),
   onLinkOpened: event<ModelLinkEvent>(),
   takePendingLink: request().returns<ModelLinkEvent | null>()
});
