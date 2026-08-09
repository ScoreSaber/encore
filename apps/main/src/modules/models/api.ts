import { defineDomainApi, targetProcedure, type TargetCall } from '@/lib/api';
import {
   modelCollectionRequestSchema,
   modelCollectionSnapshotSchema,
   type ModelDetailRequest,
   modelDeletePreviewSchema,
   modelDownloadRequestSchema,
   modelSearchRequestSchema,
   modelSearchResultSchema,
   modelSelectionRequestSchema
} from '@/modules/models/contract';
import { operationResultSchema } from '@/modules/operations/contract';

export const modelsApi = defineDomainApi(
   'models',
   {
      list: targetProcedure({
         capability: 'manage-models',
         input: modelCollectionRequestSchema,
         output: modelCollectionSnapshotSchema
      }),
      rescan: targetProcedure({
         capability: 'manage-models',
         input: modelCollectionRequestSchema,
         output: modelCollectionSnapshotSchema
      }),
      previewDelete: targetProcedure({
         capability: 'manage-models',
         input: modelSelectionRequestSchema,
         output: modelDeletePreviewSchema
      }),
      startDelete: targetProcedure({
         capability: 'manage-models',
         input: modelSelectionRequestSchema,
         output: operationResultSchema
      }),
      startDownload: targetProcedure({
         capability: 'manage-models',
         input: modelDownloadRequestSchema,
         output: operationResultSchema
      }),
      search: targetProcedure({
         capability: 'manage-models',
         input: modelSearchRequestSchema,
         output: modelSearchResultSchema
      })
   },
   { snapshot: modelCollectionSnapshotSchema }
);

export type TargetModelCollectionRequest = TargetCall<typeof modelsApi.procedures.list>;
export type TargetModelDetailRequest = TargetModelCollectionRequest & ModelDetailRequest;
export type TargetModelSelectionRequest = TargetCall<typeof modelsApi.procedures.previewDelete>;
export type TargetModelDownloadRequest = TargetCall<typeof modelsApi.procedures.startDownload>;
export type TargetModelSearchRequest = TargetCall<typeof modelsApi.procedures.search>;
