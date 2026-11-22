import { z } from 'zod';

import type { IpcTransportValue } from '@/ipc/core';
import { targetCapabilitySchema, targetSchema, type TargetCapability } from '@/modules/targets/contract';

export const receiverProtocolVersion = 15;
export const receiverSupportedProtocolVersions = [receiverProtocolVersion];
export const receiverProtocolVersionHeader = 'x-encore-protocol-version';
export const receiverTargetIdHeader = 'x-encore-target-id';

export function receiverProcedurePath(namespace: string, method: string): `/rpc/${string}/${string}` {
   return `/rpc/${namespace}/${method}`;
}

export function receiverUploadPath(namespace: string, method: string): `/upload/${string}/${string}` {
   return `/upload/${namespace}/${method}`;
}

export function receiverDownloadPath(namespace: string, method: string): `/download/${string}/${string}` {
   return `/download/${namespace}/${method}`;
}

export const receiverProcedureEnvelopeSchema = z.object({
   protocolVersion: z.int().positive(),
   value: z.json()
});

export const receiverDeviceNameSchema = z.string().trim().min(1).max(80);
export const receiverPairingCodeSchema = z
   .string()
   .trim()
   .regex(/^\d{6}$/);
const receiverTokenSchema = z.string().trim().min(32);
const receiverProtocolVersionSchema = z.int().positive();

function receiverResponseSchema<Fields extends Parameters<typeof z.object>[0]>(fields: Fields) {
   return z.object({ protocolVersion: receiverProtocolVersionSchema, ...fields });
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

const receiverRemoteTargetSchema = targetSchema.extend({
   kind: z.literal('remote')
});
export const receiverAttachedTargetIdSchema = z.string().regex(/^quest:[\w.:-]{1,128}$/);
const receiverAttachedTargetSchema = targetSchema.extend({
   id: receiverAttachedTargetIdSchema,
   kind: z.literal('quest')
});
const receiverTargetsFields = {
   target: receiverRemoteTargetSchema,
   attached: z.array(receiverAttachedTargetSchema)
};

export const receiverTargetCapabilities: TargetCapability[] = [...targetCapabilitySchema.options];

export const receiverPairCompleteResponseSchema = receiverResponseSchema({
   token: receiverTokenSchema,
   device: z.object({
      id: z.string(),
      name: z.string(),
      pairedAt: z.string(),
      lastSeenAt: z.string().optional()
   }),
   ...receiverTargetsFields
});

export const receiverCapabilitiesResponseSchema = receiverResponseSchema(receiverTargetsFields);

export const receiverStreamEventSchema = z.discriminatedUnion('type', [
   z.object({
      type: z.literal('heartbeat'),
      sentAt: z.string()
   }),
   z.object({
      type: z.literal('target'),
      ...receiverTargetsFields
   }),
   z.object({
      type: z.literal('snapshot'),
      namespace: z.string().min(1),
      targetId: receiverAttachedTargetIdSchema.optional(),
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
export type ReceiverStreamInput =
   | Exclude<ReceiverStreamEvent, { type: 'snapshot' }>
   | { type: 'snapshot'; namespace: string; targetId?: string; value: IpcTransportValue };

export function negotiateReceiverProtocolVersion(supported: readonly number[]) {
   const shared = supported.filter((version) => receiverSupportedProtocolVersions.includes(version));
   return shared.length > 0 ? Math.max(...shared) : null;
}
