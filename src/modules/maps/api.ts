import { defineDomainApi, targetProcedure, type TargetCall } from '@/lib/api';
import {
   mapCollectionRequestSchema,
   mapCollectionSnapshotSchema,
   mapCoverResultSchema,
   mapDetailRequestSchema,
   mapDeletePreviewSchema,
   mapDownloadRequestSchema,
   mapSearchRequestSchema,
   mapSearchResultSchema,
   mapSelectionRequestSchema
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
      getCover: targetProcedure({
         capability: 'manage-maps',
         input: mapDetailRequestSchema,
         output: mapCoverResultSchema
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
   { snapshot: mapCollectionSnapshotSchema }
);

export type TargetMapCollectionRequest = TargetCall<typeof mapsApi.procedures.list>;
export type TargetMapDetailRequest = TargetCall<typeof mapsApi.procedures.getCover>;
export type TargetMapSelectionRequest = TargetCall<typeof mapsApi.procedures.previewDelete>;
export type TargetMapDownloadRequest = TargetCall<typeof mapsApi.procedures.startDownload>;
export type TargetMapSearchRequest = TargetCall<typeof mapsApi.procedures.search>;
