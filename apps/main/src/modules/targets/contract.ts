import { z } from 'zod';

import { installIdSchema } from '@/modules/installs/contract';

export const localTargetId = 'local';
export const questTargetIdPrefix = 'quest:';

export function isQuestTargetId(targetId: string) {
   return targetId.startsWith(questTargetIdPrefix);
}

export const targetIdSchema = z.string().min(1);
export const targetIdRequestSchema = z.object({ targetId: targetIdSchema });
export const targetInstallRequestSchema = targetIdRequestSchema.extend({ installId: installIdSchema });

export type TargetId = string;
export type TargetRequest<Request> = Request & { targetId: TargetId };

export const targetCapabilitySchema = z.enum([
   'adopt-bsmanager',
   'browse-files',
   'download-install',
   'import-install',
   'launch-install',
   'list-installs',
   'manage-installs',
   'manage-maps',
   'manage-models',
   'manage-mods',
   'manage-playlists',
   'mirror-install',
   'patch-game',
   'read-logs',
   'run-operations',
   'share-content',
   'update-app'
]);
const targetStatusSchema = z.enum(['ready', 'unpaired', 'disconnected', 'incompatible']);
export const targetSchema = z.object({
   id: z.string(),
   kind: z.enum(['local', 'remote', 'quest']),
   name: z.string(),
   status: targetStatusSchema,
   capabilities: z.array(targetCapabilitySchema),
   address: z.string().optional(),
   fingerprint: z.string().optional(),
   message: z.string().optional(),
   via: z.string().optional(),
   connection: z.enum(['usb', 'wifi', 'remote']).optional(),
   hardware: z.enum(['steam-frame']).optional()
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

export function runsOnSteamFrame(targets: Target[]) {
   return targets.some((target) => target.id === localTargetId && target.hardware === 'steam-frame');
}
export type TargetCapability = z.infer<typeof targetCapabilitySchema>;
export type TargetConnection = NonNullable<Target['connection']>;

export type TargetEvent = z.infer<typeof targetEventSchema>;
