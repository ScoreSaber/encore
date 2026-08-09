import { z } from 'zod';

export const localTargetId = 'local';

export const targetIdSchema = z.string().min(1);

export type TargetId = string;
export type TargetRequest<Request> = Request & { targetId: TargetId };

export const targetCapabilitySchema = z.enum([
   'adopt-bsmanager',
   'download-install',
   'import-install',
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
]);
export const targetStatusSchema = z.enum(['ready', 'unpaired', 'disconnected', 'incompatible']);
export const targetSchema = z.object({
   id: z.string(),
   kind: z.enum(['local', 'remote']),
   name: z.string(),
   status: targetStatusSchema,
   capabilities: z.array(targetCapabilitySchema),
   address: z.string().optional(),
   fingerprint: z.string().optional(),
   message: z.string().optional()
});

const targetEventSchema = z.discriminatedUnion('type', [
   z.object({
      type: z.literal('target-updated'),
      target: targetSchema
   }),
   z.object({
      type: z.literal('target-removed'),
      targetId: z.string()
   })
]);

export type Target = z.infer<typeof targetSchema>;
export type TargetStatus = z.infer<typeof targetStatusSchema>;
export type TargetCapability = z.infer<typeof targetCapabilitySchema>;

export type TargetEvent = z.infer<typeof targetEventSchema>;

export type TargetHealth = {
   status: TargetStatus;
   capabilities: TargetCapability[];
   message?: string;
};
