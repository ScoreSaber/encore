import { defineDomainApi, targetProcedure } from '@/lib/api';
import { operationResultSchema } from '@/modules/operations/contract';
import { questStateSchema } from '@/modules/quest/contract';

export const questApi = defineDomainApi(
   'quest',
   {
      getState: targetProcedure({ capability: 'patch-game', output: questStateSchema }),
      patch: targetProcedure({ capability: 'patch-game', output: operationResultSchema }),
      unmod: targetProcedure({ capability: 'patch-game', output: operationResultSchema }),
      stopGame: targetProcedure({ capability: 'launch-install', output: operationResultSchema })
   },
   { snapshot: questStateSchema }
);
