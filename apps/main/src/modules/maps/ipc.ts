import { z } from 'zod';

import { defineIpc, event, linkRegistrationSchema, request, type FileExportChoice, type FileImportChoice, type OpenFolderResult } from '@/ipc/core';
import {
   type MapLinkEvent,
   type MapLinkProtocolResult,
   type MapLinkProtocolState,
   mapMetadataRequestSchema,
   type MapMetadataResult,
   type MapOperationResult
} from '@/modules/maps/contract';
import { targetInstallRequestSchema } from '@/modules/targets/contract';

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

export const mapsIpc = defineIpc('maps', {
   getMapLinkState: request().returns<MapLinkProtocolState>(),
   getMetadata: request(mapMetadataRequestSchema).returns<MapMetadataResult>(),
   openMapFolder: request(mapDetailRequestSchema).returns<OpenFolderResult>(),
   chooseMapImport: request(targetInstallRequestSchema).returns<FileImportChoice>(),
   importMaps: request(mapImportRequestSchema).returns<MapOperationResult>(),
   chooseMapExport: request(mapSelectionRequestSchema).returns<FileExportChoice>(),
   exportMaps: request(mapExportRequestSchema).returns<MapOperationResult>(),
   setMapLinkRegistered: request(linkRegistrationSchema).returns<MapLinkProtocolResult>(),
   onLinkOpened: event<MapLinkEvent>(),
   takePendingLink: request().returns<MapLinkEvent | null>()
});
