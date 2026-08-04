import { z } from 'zod';

import { defineDomainApi, targetProcedure } from '@/lib/api';
import { operationCancelResultSchema, operationSnapshotSchema } from '@/modules/operations/contract';

const operationCancelInputSchema = z.object({ id: z.string().min(1) });
export const operationsApi = defineDomainApi(
   'operations',
   {
      list: targetProcedure({
         capability: 'run-operations',
         output: z.array(operationSnapshotSchema)
      }),
      cancel: targetProcedure({
         capability: 'run-operations',
         input: operationCancelInputSchema,
         output: operationCancelResultSchema
      })
   },
   { snapshot: operationSnapshotSchema }
);
