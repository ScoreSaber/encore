import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   installActionRequestSchema,
   installDeletePreviewSchema,
   installDetailSchema,
   installDetailResultSchema,
   installForgetPreviewSchema,
   installForgetResultSchema,
   installImportPreviewSchema,
   installImportSourceSchema,
   installPinRequestSchema,
   installRegistryResultSchema,
   installRegistrySnapshotSchema,
   installReorderRequestSchema,
   installUpdateRequestSchema
} from '@/modules/installs/contract';
import { operationResultSchema } from '@/modules/operations/contract';

export const installsApi = defineDomainApi(
   'installs',
   {
      list: targetProcedure({
         capability: 'list-installs',
         output: installRegistrySnapshotSchema
      }),
      previewImport: targetProcedure({
         capability: 'import-install',
         input: installImportSourceSchema,
         output: installImportPreviewSchema
      }),
      importFolder: targetProcedure({
         capability: 'import-install',
         input: installImportSourceSchema,
         output: installDetailResultSchema
      }),
      getDetail: targetProcedure({
         capability: 'list-installs',
         input: installActionRequestSchema,
         output: installDetailSchema.nullable()
      }),
      rescan: targetProcedure({
         capability: 'list-installs',
         output: installRegistrySnapshotSchema
      }),
      update: targetProcedure({
         capability: 'manage-installs',
         input: installUpdateRequestSchema,
         output: installDetailResultSchema
      }),
      setPinned: targetProcedure({
         capability: 'manage-installs',
         input: installPinRequestSchema,
         output: installRegistryResultSchema
      }),
      reorder: targetProcedure({
         capability: 'manage-installs',
         input: installReorderRequestSchema,
         output: installRegistryResultSchema
      }),
      previewDelete: targetProcedure({
         capability: 'manage-installs',
         input: installActionRequestSchema,
         output: installDeletePreviewSchema
      }),
      delete: targetProcedure({
         capability: 'manage-installs',
         input: installActionRequestSchema,
         output: operationResultSchema
      }),
      previewForget: targetProcedure({
         capability: 'manage-installs',
         input: installActionRequestSchema,
         output: installForgetPreviewSchema
      }),
      forget: targetProcedure({
         capability: 'manage-installs',
         input: installActionRequestSchema,
         output: installForgetResultSchema
      })
   },
   { snapshot: installRegistrySnapshotSchema }
);
