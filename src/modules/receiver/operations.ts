import type { z } from 'zod';

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
   id: string;
   method: 'GET' | 'POST';
   path: `/${string}`;
   authenticated: boolean;
   request?: z.ZodType;
   response: z.ZodType<object>;
   invalidRequest?: {
      code: string;
      message: string;
   };
};

export type ReceiverRequestOperation = ReceiverOperationDefinition & {
   request: z.ZodType;
   invalidRequest: { code: string; message: string };
};

function defineReceiverOperation<const Definition extends ReceiverOperationDefinition>(definition: Definition) {
   return definition;
}

export const receiverOperations = {
   health: defineReceiverOperation({
      id: 'receiver:health',
      method: 'GET',
      path: '/health',
      authenticated: false,
      response: receiverHealthResponseSchema
   }),
   pairStart: defineReceiverOperation({
      id: 'receiver:pair-start',
      method: 'POST',
      path: '/pair/start',
      authenticated: false,
      request: receiverPairStartRequestSchema,
      response: receiverPairStartResponseSchema,
      invalidRequest: {
         code: 'receiver.pair-start.invalid',
         message: 'Pairing request is invalid'
      }
   }),
   pairComplete: defineReceiverOperation({
      id: 'receiver:pair-complete',
      method: 'POST',
      path: '/pair/complete',
      authenticated: false,
      request: receiverPairCompleteRequestSchema,
      response: receiverPairCompleteResponseSchema,
      invalidRequest: {
         code: 'receiver.pair-complete.invalid',
         message: 'Pairing request is invalid'
      }
   }),
   capabilities: defineReceiverOperation({
      id: 'targets:health',
      method: 'GET',
      path: '/capabilities',
      authenticated: true,
      response: receiverCapabilitiesResponseSchema
   }),
   events: defineReceiverOperation({
      id: 'receiver:events',
      method: 'GET',
      path: '/events',
      authenticated: true,
      response: receiverStreamEventSchema
   })
};
