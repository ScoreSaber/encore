import { defineDomainApi, targetProcedure } from '@/lib/api';
import { updateStateSchema } from '@/modules/updates/contract';

export const updatesApi = defineDomainApi(
   'updates',
   {
      getState: targetProcedure({ capability: 'update-app', output: updateStateSchema }),
      check: targetProcedure({ capability: 'update-app', output: updateStateSchema }),
      download: targetProcedure({ capability: 'update-app', output: updateStateSchema }),
      install: targetProcedure({ capability: 'update-app', output: updateStateSchema }),
      update: targetProcedure({ capability: 'update-app', output: updateStateSchema })
   },
   { snapshot: updateStateSchema }
);
