import { z } from 'zod';

import { targetSchema } from '@/shared/targets';

export const receiverProtocolVersion = 1;

export const receiverDeviceNameSchema = z.string().trim().min(1).max(80);
export const receiverPairingCodeSchema = z
   .string()
   .trim()
   .regex(/^\d{6}$/);
export const receiverTokenSchema = z.string().trim().min(32);

export const receiverHealthResponseSchema = z.object({
   protocolVersion: z.literal(receiverProtocolVersion),
   name: z.string(),
   status: z.literal('ready')
});

export const receiverPairStartRequestSchema = z.object({
   deviceName: receiverDeviceNameSchema
});

export const receiverPairStartResponseSchema = z.object({
   protocolVersion: z.literal(receiverProtocolVersion),
   name: z.string(),
   pairing: z.discriminatedUnion('status', [
      z.object({
         status: z.literal('waiting'),
         expiresAt: z.string()
      }),
      z.object({
         status: z.literal('not-started')
      })
   ])
});

export const receiverPairCompleteRequestSchema = z.object({
   code: receiverPairingCodeSchema,
   deviceName: receiverDeviceNameSchema
});

export const receiverRemoteTargetSchema = targetSchema.extend({
   kind: z.literal('remote')
});

export const receiverPairCompleteResponseSchema = z.object({
   protocolVersion: z.literal(receiverProtocolVersion),
   token: receiverTokenSchema,
   device: z.object({
      id: z.string(),
      name: z.string(),
      pairedAt: z.string(),
      lastSeenAt: z.string().optional()
   }),
   target: receiverRemoteTargetSchema
});

export const receiverCapabilitiesResponseSchema = z.object({
   protocolVersion: z.literal(receiverProtocolVersion),
   target: receiverRemoteTargetSchema
});

export const receiverErrorResponseSchema = z.object({
   error: z.object({
      code: z.string(),
      message: z.string()
   })
});

export type ReceiverHealthResponse = z.infer<typeof receiverHealthResponseSchema>;
export type ReceiverPairStartRequest = z.infer<typeof receiverPairStartRequestSchema>;
export type ReceiverPairStartResponse = z.infer<typeof receiverPairStartResponseSchema>;
export type ReceiverPairCompleteRequest = z.infer<typeof receiverPairCompleteRequestSchema>;
export type ReceiverPairCompleteResponse = z.infer<typeof receiverPairCompleteResponseSchema>;
export type ReceiverCapabilitiesResponse = z.infer<typeof receiverCapabilitiesResponseSchema>;
export type ReceiverErrorResponse = z.infer<typeof receiverErrorResponseSchema>;
