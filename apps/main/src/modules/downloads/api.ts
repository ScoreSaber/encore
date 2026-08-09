import { z } from 'zod';

import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   downloadCatalogSnapshotSchema,
   downloadRequestSchema,
   downloadStartResultSchema,
   oculusDownloadPreviewSchema,
   steamDownloadPreviewSchema,
   unavailableDownloadPreviewSchema
} from '@/modules/downloads/contract';

const downloadPreviewValueSchema = z.union([unavailableDownloadPreviewSchema, steamDownloadPreviewSchema, oculusDownloadPreviewSchema]);
export const downloadsApi = defineDomainApi('downloads', {
   getCatalog: targetProcedure({
      capability: 'download-install',
      output: downloadCatalogSnapshotSchema.nullable()
   }),
   refreshCatalog: targetProcedure({
      capability: 'download-install',
      output: downloadCatalogSnapshotSchema.nullable()
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
