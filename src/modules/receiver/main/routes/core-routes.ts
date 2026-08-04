import { Result } from 'better-result';

import { readRequestAddress, writeError } from '@/modules/receiver/main/receiver-http';
import {
   readReceiverRequest,
   receiverRequestRoute,
   receiverRoute,
   writeReceiverResponse,
   type ReceiverResponsePayload,
   type Route
} from '@/modules/receiver/main/routes/route-table';
import { receiverOperations } from '@/modules/receiver/operations';
import { receiverSupportedProtocolVersions } from '@/modules/receiver/protocol';

export const coreRoutes: Route[] = [
   receiverRoute(
      receiverOperations.health,
      (context): ReceiverResponsePayload<typeof receiverOperations.health.response> => ({
         supportedProtocolVersions: receiverSupportedProtocolVersions,
         name: context.name,
         status: 'ready'
      })
   ),
   receiverRequestRoute(receiverOperations.pairStart, (_input, context): ReceiverResponsePayload<typeof receiverOperations.pairStart.response> => {
      const session = context.pairing.getSession();
      return {
         name: context.name,
         pairing: session ? { status: 'waiting', expiresAt: session.expiresAt } : { status: 'not-started' }
      };
   }),
   {
      method: receiverOperations.pairComplete.method,
      path: receiverOperations.pairComplete.path,
      authenticated: receiverOperations.pairComplete.authenticated,
      handle: async (request, response, context) => {
         const input = await readReceiverRequest(request, receiverOperations.pairComplete);
         if (Result.isError(input)) return writeError(response, input.error);

         const completed = await context.pairing.complete({ ...input.value, address: readRequestAddress(request) });
         if (Result.isError(completed)) return writeError(response, completed.error);

         writeReceiverResponse(response, receiverOperations.pairComplete, {
            token: completed.value.token,
            device: {
               id: completed.value.device.id,
               name: completed.value.device.name,
               pairedAt: completed.value.device.pairedAt,
               lastSeenAt: completed.value.device.lastSeenAt
            },
            target: context.getTarget()
         });
      }
   },
   receiverRoute(receiverOperations.capabilities, (context) => ({ target: context.getTarget() }))
];
