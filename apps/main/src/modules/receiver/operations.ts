import type { z } from 'zod';

import type { ProblemCode } from '@/lib/messages';
import {
   receiverCapabilitiesResponseSchema,
   receiverHealthResponseSchema,
   receiverPairCompleteRequestSchema,
   receiverPairCompleteResponseSchema,
   receiverPairStartRequestSchema,
   receiverPairStartResponseSchema,
   receiverStreamEventSchema
} from '@/modules/receiver/protocol';

export type ReceiverOperationDefinition = {
   method: 'GET' | 'POST';
   path: `/${string}`;
   authenticated: boolean;
   request?: z.ZodType;
   response: z.ZodType<object>;
   invalidRequest?: ProblemCode;
};

export type ReceiverRequestOperation = ReceiverOperationDefinition & {
   request: z.ZodType;
   invalidRequest: ProblemCode;
};

function defineReceiverOperation<const Definition extends ReceiverOperationDefinition>(definition: Definition) {
   return definition;
}

export const receiverOperations = {
   health: defineReceiverOperation({
      method: 'GET',
      path: '/health',
      authenticated: false,
      response: receiverHealthResponseSchema
   }),
   pairStart: defineReceiverOperation({
      method: 'POST',
      path: '/pair/start',
      authenticated: false,
      request: receiverPairStartRequestSchema,
      response: receiverPairStartResponseSchema,
      invalidRequest: 'receiver.pairing.invalid-request'
   }),
   pairComplete: defineReceiverOperation({
      method: 'POST',
      path: '/pair/complete',
      authenticated: false,
      request: receiverPairCompleteRequestSchema,
      response: receiverPairCompleteResponseSchema,
      invalidRequest: 'receiver.pairing.invalid-request'
   }),
   capabilities: defineReceiverOperation({
      method: 'GET',
      path: '/capabilities',
      authenticated: true,
      response: receiverCapabilitiesResponseSchema
   }),
   events: defineReceiverOperation({
      method: 'GET',
      path: '/events',
      authenticated: true,
      response: receiverStreamEventSchema
   })
};
