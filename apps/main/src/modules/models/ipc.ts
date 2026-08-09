import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/ipc/core';
import {
   type ModelCollectionRequest,
   type ModelDetailRequest,
   type ModelExportChoice,
   type ModelExportRequest,
   type ModelImportChoice,
   type ModelImportRequest,
   type ModelLinkEvent,
   type ModelLinkProtocolResult,
   type ModelLinkProtocolState,
   type ModelOpenFolderResult,
   type ModelOperationResult,
   type ModelSelectionRequest
} from '@/modules/models/contract';
import type { TargetRequest } from '@/modules/targets/contract';
import { targetInstallRequestSchema } from '@/modules/targets/ipc';

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

const modelLinkRegistrationSchema = z.object({
   registered: z.boolean()
});

export const modelsIpc = defineIpcDescriptor({
   getModelLinkState: defineIpcQuery<ModelLinkProtocolState>('models:link-state'),
   openModelFolder: defineIpcCommand<ModelOpenFolderResult, TargetRequest<ModelDetailRequest>>('models:open-folder', modelDetailRequestSchema),
   chooseModelImport: defineIpcCommand<ModelImportChoice, TargetRequest<ModelCollectionRequest>>('models:choose-import', targetInstallRequestSchema),
   importModels: defineIpcCommand<ModelOperationResult, TargetRequest<ModelImportRequest>>('models:import', modelImportRequestSchema),
   chooseModelExport: defineIpcCommand<ModelExportChoice, TargetRequest<ModelSelectionRequest>>('models:choose-export', modelSelectionRequestSchema),
   exportModels: defineIpcCommand<ModelOperationResult, TargetRequest<ModelExportRequest>>('models:export', modelExportRequestSchema),
   setModelLinkRegistered: defineIpcCommand<ModelLinkProtocolResult, { registered: boolean }>(
      'models:set-link-registered',
      modelLinkRegistrationSchema
   ),
   onLinkOpened: defineIpcEvent<ModelLinkEvent>('models:link-opened'),
   takePendingLink: defineIpcCommand<ModelLinkEvent | null>('models:take-pending-link')
});
