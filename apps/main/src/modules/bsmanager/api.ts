import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   bsmanagerAdoptInputSchema,
   bsmanagerAdoptResultSchema,
   bsmanagerCleanupInputSchema,
   bsmanagerDetectionSchema,
   bsmanagerPlanSchema
} from '@/modules/bsmanager/contract';
import { operationResultSchema } from '@/modules/operations/contract';

export const bsmanagerApi = defineDomainApi('bsmanager', {
   detect: targetProcedure({ capability: 'adopt-bsmanager', output: bsmanagerDetectionSchema }),
   plan: targetProcedure({ capability: 'adopt-bsmanager', output: bsmanagerPlanSchema }),
   adopt: targetProcedure({ capability: 'adopt-bsmanager', input: bsmanagerAdoptInputSchema, output: bsmanagerAdoptResultSchema }),
   cleanup: targetProcedure({ capability: 'adopt-bsmanager', input: bsmanagerCleanupInputSchema, output: operationResultSchema })
});
