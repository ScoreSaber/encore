import { z } from 'zod';

import { defineDomainApi, targetProcedure } from '@/lib/api';
import {
   launchRequestBodySchema,
   launchResultSchema,
   launchStateSchema,
   readyLaunchPreviewSchema,
   unavailableLaunchPreviewSchema
} from '@/modules/launch/contract';

const launchPreviewValueSchema = z.discriminatedUnion('status', [unavailableLaunchPreviewSchema, readyLaunchPreviewSchema]);
export const launchApi = defineDomainApi('launch', {
   getState: targetProcedure({
      capability: 'launch-install',
      output: launchStateSchema.nullable()
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
});
