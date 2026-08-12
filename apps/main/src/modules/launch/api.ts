import { z } from 'zod';

import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   launchOptionsRequestSchema,
   launchOptionsResultSchema,
   launchOptionsSchema,
   launchRequestBodySchema,
   launchResultSchema,
   launchStateSchema,
   readyLaunchPreviewSchema,
   unavailableLaunchPreviewSchema
} from '@/modules/launch/contract';

const launchPreviewValueSchema = z.discriminatedUnion('status', [unavailableLaunchPreviewSchema, readyLaunchPreviewSchema]);
export const launchApi = defineDomainApi(
   'launch',
   {
      getState: targetProcedure({
         capability: 'launch-install',
         output: launchStateSchema.nullable()
      }),
      getOptions: targetProcedure({
         capability: 'launch-install',
         input: launchOptionsRequestSchema,
         output: launchOptionsSchema
      }),
      updateOptions: targetProcedure({
         capability: 'launch-install',
         input: launchRequestBodySchema,
         output: launchOptionsResultSchema
      }),
      preview: targetProcedure({
         capability: 'launch-install',
         input: launchRequestBodySchema,
         output: launchPreviewValueSchema
      }),
      start: targetProcedure({
         capability: 'launch-install',
         input: launchRequestBodySchema,
         output: launchResultSchema
      })
   },
   { snapshot: launchStateSchema }
);
