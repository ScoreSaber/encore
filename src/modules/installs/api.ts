import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   installActionRequestSchema,
   installDeletePreviewSchema,
   installDetailSchema,
   installDetailResultSchema,
   installForgetPreviewSchema,
   installForgetResultSchema,
   installOperationResultSchema,
   installRegistrySnapshotSchema,
   installUpdateRequestSchema
} from '@/modules/installs/contract';

export const installsApi = defineDomainApi(
   'installs',
   {
      list: targetProcedure({
         capability: 'list-installs',
         output: installRegistrySnapshotSchema
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
      previewDelete: targetProcedure({
         capability: 'manage-installs',
         input: installActionRequestSchema,
         output: installDeletePreviewSchema
      }),
      delete: targetProcedure({
         capability: 'manage-installs',
         input: installActionRequestSchema,
         output: installOperationResultSchema
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
