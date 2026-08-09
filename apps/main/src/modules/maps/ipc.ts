import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/ipc/core';
import {
   type MapCollectionRequest,
   type MapDetailRequest,
   type MapExportChoice,
   type MapExportRequest,
   type MapImportChoice,
   type MapImportRequest,
   type MapLinkEvent,
   type MapLinkProtocolResult,
   type MapLinkProtocolState,
   mapMetadataRequestSchema,
   type MapMetadataRequest,
   type MapMetadataResult,
   type MapOpenFolderResult,
   type MapOperationResult,
   type MapSelectionRequest
} from '@/modules/maps/contract';
import type { TargetRequest } from '@/modules/targets/contract';
import { targetInstallRequestSchema } from '@/modules/targets/ipc';

const mapDetailRequestSchema = targetInstallRequestSchema.extend({
   mapId: z.string().min(1)
});

const mapSelectionRequestSchema = targetInstallRequestSchema.extend({
   mapIds: z.array(z.string().min(1))
});

const mapImportRequestSchema = targetInstallRequestSchema.extend({
   paths: z.array(z.string().min(1))
});

const mapExportRequestSchema = mapSelectionRequestSchema.extend({
   destinationPath: z.string().min(1)
});

const mapLinkRegistrationSchema = z.object({
   registered: z.boolean()
});

export const mapsIpc = defineIpcDescriptor({
   getMapLinkState: defineIpcQuery<MapLinkProtocolState>('maps:link-state'),
   getMetadata: defineIpcQuery<MapMetadataResult, MapMetadataRequest>('maps:metadata', mapMetadataRequestSchema),
   openMapFolder: defineIpcCommand<MapOpenFolderResult, TargetRequest<MapDetailRequest>>('maps:open-folder', mapDetailRequestSchema),
   chooseMapImport: defineIpcCommand<MapImportChoice, TargetRequest<MapCollectionRequest>>('maps:choose-import', targetInstallRequestSchema),
   importMaps: defineIpcCommand<MapOperationResult, TargetRequest<MapImportRequest>>('maps:import', mapImportRequestSchema),
   chooseMapExport: defineIpcCommand<MapExportChoice, TargetRequest<MapSelectionRequest>>('maps:choose-export', mapSelectionRequestSchema),
   exportMaps: defineIpcCommand<MapOperationResult, TargetRequest<MapExportRequest>>('maps:export', mapExportRequestSchema),
   setMapLinkRegistered: defineIpcCommand<MapLinkProtocolResult, { registered: boolean }>('maps:set-link-registered', mapLinkRegistrationSchema),
   onLinkOpened: defineIpcEvent<MapLinkEvent>('maps:link-opened'),
   takePendingLink: defineIpcCommand<MapLinkEvent | null>('maps:take-pending-link')
});
