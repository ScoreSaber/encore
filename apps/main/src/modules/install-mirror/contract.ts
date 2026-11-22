import { z } from 'zod';

import { installIdSchema } from '@/modules/installs/contract';
import { operationErrorSchema } from '@/modules/operations/contract';

export const mirrorPageSize = 5_000;

const mirrorRelativePathSchema = z
   .string()
   .min(1)
   .max(1024)
   .refine((path) => !/[\\:]/.test(path) && path.split('/').every((segment) => segment && segment !== '.' && segment !== '..'));

const mirrorSectionSchema = z.discriminatedUnion('kind', [
   z.object({ kind: z.literal('install') }),
   z.object({ kind: z.literal('appdata') }),
   z.object({ kind: z.literal('link'), path: mirrorRelativePathSchema })
]);

export const mirrorManifestRequestSchema = z.object({
   installId: installIdSchema,
   section: mirrorSectionSchema,
   walkId: z.uuid().optional(),
   offset: z.number().int().nonnegative()
});

export const mirrorFileRequestSchema = z.object({
   installId: installIdSchema,
   section: mirrorSectionSchema,
   path: mirrorRelativePathSchema
});

export const mirrorBatchLimit = { files: 1_000, bytes: 32 * 1024 * 1024, pathBytes: 24_000, largeFileBytes: 4 * 1024 * 1024 };

export const mirrorBatchRequestSchema = z.object({
   installId: installIdSchema,
   section: mirrorSectionSchema,
   paths: z.array(mirrorRelativePathSchema).min(1).max(mirrorBatchLimit.files)
});

const mirrorEntrySchema = z.object({ path: mirrorRelativePathSchema, size: z.number().int().nonnegative(), mtimeMs: z.number() });
const mirrorLinkSchema = z.object({ path: mirrorRelativePathSchema, sharedPath: mirrorRelativePathSchema });

const mirrorManifestPageSchema = z.object({
   walkId: z.uuid(),
   entries: z.array(mirrorEntrySchema),
   links: z.array(mirrorLinkSchema),
   next: z.number().int().nonnegative().nullable()
});

export const mirrorManifestResultSchema = z.union([
   z.object({ ok: z.literal(true), value: mirrorManifestPageSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export const mirrorRequestSchema = z.object({
   sourceTargetId: z.string().min(1),
   sourceInstallIds: z.array(installIdSchema).min(1).max(32),
   replaceOthers: z.boolean().optional()
});
export const mirrorStartRequestSchema = mirrorRequestSchema.extend({ planKey: z.string().min(1) });

const mirrorRemovalSchema = z.object({
   installId: installIdSchema,
   name: z.string(),
   path: z.string(),
   store: z.boolean()
});

const mirrorInstallPlanSchema = z.object({
   sourceInstallId: installIdSchema,
   name: z.string(),
   color: z.string().nullable(),
   version: z.string(),
   destinationPath: z.string(),
   resync: z.boolean()
});

const mirrorPreviewSchema = z.object({
   sourceDevice: z.string(),
   installs: z.array(mirrorInstallPlanSchema),
   resync: z.boolean(),
   planKey: z.string(),
   sharedRoot: z.string(),
   appDataPath: z.string(),
   removals: z.array(mirrorRemovalSchema)
});

export const mirrorPreviewResultSchema = z.union([
   z.object({ ok: z.literal(true), value: mirrorPreviewSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export const mirrorResultSchema = z.object({ installIds: z.array(installIdSchema), bytes: z.number(), protonRequested: z.boolean().default(false) });

export type MirrorSection = z.infer<typeof mirrorSectionSchema>;
export type MirrorEntry = z.infer<typeof mirrorEntrySchema>;
export type MirrorLink = z.infer<typeof mirrorLinkSchema>;
export type MirrorManifestPage = z.infer<typeof mirrorManifestPageSchema>;
export type MirrorManifestRequest = z.infer<typeof mirrorManifestRequestSchema>;
export type MirrorFileRequest = z.infer<typeof mirrorFileRequestSchema>;
export type MirrorBatchRequest = z.infer<typeof mirrorBatchRequestSchema>;
export type MirrorRequest = z.infer<typeof mirrorRequestSchema>;
export type MirrorStartRequest = z.infer<typeof mirrorStartRequestSchema>;
export type MirrorPreview = z.infer<typeof mirrorPreviewSchema>;
export type MirrorInstallPlan = z.infer<typeof mirrorInstallPlanSchema>;
