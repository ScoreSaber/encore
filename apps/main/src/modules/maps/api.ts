import { defineDomainApi, targetDownload, targetProcedure, targetUpload, type TargetCall } from '@/lib/api';
import {
   mapCollectionRequestSchema,
   mapCollectionSnapshotSchema,
   mapCoversRequestSchema,
   mapCoversResultSchema,
   mapDeletePreviewSchema,
   mapDetailRequestSchema,
   mapDownloadRequestSchema,
   mapSearchRequestSchema,
   mapSearchResultSchema,
   mapSelectionRequestSchema,
   mapSyncPreviewSchema,
   mapSyncStartResultSchema,
   mapSyncRequestSchema
} from '@/modules/maps/contract';
import { operationResultSchema } from '@/modules/operations/contract';

export const mapsApi = defineDomainApi(
   'maps',
   {
      list: targetProcedure({
         capability: 'manage-maps',
         input: mapCollectionRequestSchema,
         output: mapCollectionSnapshotSchema
      }),
      rescan: targetProcedure({
         capability: 'manage-maps',
         input: mapCollectionRequestSchema,
         output: mapCollectionSnapshotSchema
      }),
      getCovers: targetProcedure({
         capability: 'manage-maps',
         input: mapCoversRequestSchema,
         output: mapCoversResultSchema
      }),
      previewDelete: targetProcedure({
         capability: 'manage-maps',
         input: mapSelectionRequestSchema,
         output: mapDeletePreviewSchema
      }),
      startDelete: targetProcedure({
         capability: 'manage-maps',
         input: mapSelectionRequestSchema,
         output: operationResultSchema
      }),
      startDownload: targetProcedure({
         capability: 'manage-maps',
         input: mapDownloadRequestSchema,
         output: operationResultSchema
      }),
      search: targetProcedure({
         capability: 'manage-maps',
         input: mapSearchRequestSchema,
         output: mapSearchResultSchema
      })
   },
   {
      snapshot: mapCollectionSnapshotSchema,
      uploads: { importArchive: targetUpload({ capability: 'manage-maps', input: mapCollectionRequestSchema }) },
      downloads: { exportArchive: targetDownload({ capability: 'manage-maps', input: mapDetailRequestSchema }) }
   }
);

export const mapSyncApi = defineDomainApi('map-sync', {
   preview: targetProcedure({ capability: 'manage-maps', input: mapSyncRequestSchema, output: mapSyncPreviewSchema }),
   start: targetProcedure({ capability: 'manage-maps', input: mapSyncRequestSchema, output: mapSyncStartResultSchema })
});

export type TargetMapCollectionRequest = TargetCall<typeof mapsApi.procedures.list>;
export type TargetMapSelectionRequest = TargetCall<typeof mapsApi.procedures.previewDelete>;
