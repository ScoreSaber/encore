import { z } from 'zod';

import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   downloadRequestSchema,
   downloadStartResultSchema,
   oculusDownloadPreviewSchema,
   steamDownloadPreviewSchema,
   targetDownloadCatalogSchema,
   unavailableDownloadPreviewSchema
} from '@/modules/downloads/contract';

const downloadPreviewValueSchema = z.union([unavailableDownloadPreviewSchema, steamDownloadPreviewSchema, oculusDownloadPreviewSchema]);
export const downloadsApi = defineDomainApi('downloads', {
   getCatalog: targetProcedure({
      capability: 'download-install',
      output: targetDownloadCatalogSchema.nullable()
   }),
   refreshCatalog: targetProcedure({
      capability: 'download-install',
      output: targetDownloadCatalogSchema.nullable()
   }),
   preview: targetProcedure({
      capability: 'download-install',
      input: downloadRequestSchema,
      output: downloadPreviewValueSchema.nullable()
   }),
   start: targetProcedure({
      capability: 'download-install',
      input: downloadRequestSchema,
      output: downloadStartResultSchema
   })
});
