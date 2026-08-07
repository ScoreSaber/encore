import { z } from 'zod';

import { targetSchema, type TargetCapability } from '@/modules/targets/contract';

export const receiverProtocolVersion = 13;
export const receiverSupportedProtocolVersions = [receiverProtocolVersion];
export const receiverProtocolVersionHeader = 'x-encore-protocol-version';

export const receiverDeviceNameSchema = z.string().trim().min(1).max(80);
export const receiverPairingCodeSchema = z
   .string()
   .trim()
   .regex(/^\d{6}$/);
export const receiverTokenSchema = z.string().trim().min(32);
export const receiverProtocolVersionSchema = z.int().positive();

function receiverResponseSchema<Shape extends z.ZodRawShape>(shape: Shape) {
   return z.object({ protocolVersion: receiverProtocolVersionSchema, ...shape });
}

export const receiverHealthResponseSchema = receiverResponseSchema({
   supportedProtocolVersions: z.array(receiverProtocolVersionSchema).min(1),
   name: z.string(),
   status: z.literal('ready')
});

export const receiverPairStartRequestSchema = z.object({
   deviceName: receiverDeviceNameSchema
});

export const receiverPairStartResponseSchema = receiverResponseSchema({
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

export const receiverTargetCapabilities: TargetCapability[] = [
   'download-install',
   'launch-install',
   'list-installs',
   'manage-installs',
   'manage-maps',
   'manage-models',
   'manage-mods',
   'manage-playlists',
   'read-logs',
   'run-operations',
   'share-content'
];

export const receiverPairCompleteResponseSchema = receiverResponseSchema({
   token: receiverTokenSchema,
   device: z.object({
      id: z.string(),
      name: z.string(),
      pairedAt: z.string(),
      lastSeenAt: z.string().optional()
   }),
   target: receiverRemoteTargetSchema
});

export const receiverCapabilitiesResponseSchema = receiverResponseSchema({
   target: receiverRemoteTargetSchema
});

export const receiverStreamEventSchema = z.discriminatedUnion('type', [
   z.object({
      type: z.literal('heartbeat'),
      sentAt: z.string()
   }),
   z.object({
      type: z.literal('target'),
      target: receiverRemoteTargetSchema
   }),
   z.object({
      type: z.literal('snapshot'),
      namespace: z.string().min(1),
      value: z.json()
   })
]);

export const receiverErrorResponseSchema = z.object({
   error: z.object({
      code: z.string(),
      message: z.string()
   })
});

export type ReceiverStreamEvent = z.infer<typeof receiverStreamEventSchema>;
export type ReceiverStreamInput = Exclude<ReceiverStreamEvent, { type: 'snapshot' }> | { type: 'snapshot'; namespace: string; value: unknown };

export function isSupportedReceiverProtocolVersion(version: number) {
   return receiverSupportedProtocolVersions.includes(version);
}

export function negotiateReceiverProtocolVersion(supported: readonly number[]) {
   const shared = supported.filter((version) => isSupportedReceiverProtocolVersion(version));
   return shared.length > 0 ? Math.max(...shared) : null;
}
