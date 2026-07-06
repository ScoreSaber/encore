import { z } from 'zod';

export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;
export type StoreKind = z.infer<typeof storeKindSchema>;
export const targetCapabilitySchema = z.enum(['list-installs']);
export const targetStatusSchema = z.enum(['ready', 'unpaired', 'disconnected']);
export const targetSchema = z.object({
   id: z.string(),
   kind: z.enum(['local', 'remote']),
   name: z.string(),
   status: targetStatusSchema,
   capabilities: z.array(targetCapabilitySchema)
});
export const installSummarySchema = z.object({
   id: z.string(),
   targetId: z.string(),
   version: z.string(),
   name: z.string().optional(),
   store: storeKindSchema.nullable()
});
export const targetEventSchema = z.discriminatedUnion('type', [
   z.object({
      type: z.literal('target-updated'),
      target: targetSchema
   }),
   z.object({
      type: z.literal('installs-updated'),
      targetId: z.string(),
      installs: z.array(installSummarySchema)
   })
]);

export type TargetId = string;
export type InstallId = string;

export type Target = z.infer<typeof targetSchema>;

export type TargetKind = Target['kind'];

export type TargetStatus = z.infer<typeof targetStatusSchema>;

export type TargetCapability = z.infer<typeof targetCapabilitySchema>;

export type TargetHealth = {
   status: TargetStatus;
   capabilities: TargetCapability[];
   message?: string;
};

export type InstallSummary = z.infer<typeof installSummarySchema>;

export type TargetEvent = z.infer<typeof targetEventSchema>;

export type TargetClient = {
   listTargets: () => Promise<Target[]>;
   listInstalls: (targetId: TargetId) => Promise<InstallSummary[]>;
   getHealth: (targetId: TargetId) => Promise<TargetHealth | null>;
   onEvent: (listener: (event: TargetEvent) => void) => () => void;
};
