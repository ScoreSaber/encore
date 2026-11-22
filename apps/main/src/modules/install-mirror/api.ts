import { defineDomainApi, targetDownload, targetProcedure } from '@/lib/api';
import {
   mirrorBatchRequestSchema,
   mirrorFileRequestSchema,
   mirrorManifestRequestSchema,
   mirrorManifestResultSchema,
   mirrorPreviewResultSchema,
   mirrorRequestSchema,
   mirrorStartRequestSchema
} from '@/modules/install-mirror/contract';
import { operationResultSchema } from '@/modules/operations/contract';

export const installMirrorApi = defineDomainApi(
   'install-mirror',
   {
      manifest: targetProcedure({ capability: 'mirror-install', input: mirrorManifestRequestSchema, output: mirrorManifestResultSchema }),
      preview: targetProcedure({ capability: 'mirror-install', input: mirrorRequestSchema, output: mirrorPreviewResultSchema }),
      start: targetProcedure({ capability: 'mirror-install', input: mirrorStartRequestSchema, output: operationResultSchema })
   },
   {
      downloads: {
         readFile: targetDownload({ capability: 'mirror-install', input: mirrorFileRequestSchema }),
         readBatch: targetDownload({ capability: 'mirror-install', input: mirrorBatchRequestSchema })
      }
   }
);
