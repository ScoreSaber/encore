import { defineDomainApi, targetProcedure } from '@/lib/api';
import { directoryListingSchema, directoryRequestSchema } from '@/modules/files/contract';

export const filesApi = defineDomainApi('files', {
   list: targetProcedure({ capability: 'browse-files', input: directoryRequestSchema, output: directoryListingSchema })
});
