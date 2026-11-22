import { z } from 'zod';

import { operationErrorSchema } from '@/modules/operations/contract';
import { storeKindSchema } from '@/modules/stores/contract';
import type { TargetId } from '@/modules/targets/contract';

export const installIdSchema = z.string().min(1);

export type InstallId = z.infer<typeof installIdSchema>;

export const installSourceSchema = z.enum(['bsmanager', 'imported', 'library', 'store']);
const installStatusSchema = z.enum(['incomplete', 'missing', 'ready']);

const installProblemCodeSchema = z.enum([
   'installs.path.unreadable',
   'installs.registry.read-failed',
   'installs.registry.write-failed',
   'installs.version.unknown'
]);

const installProblemSchema = z.object({
   code: installProblemCodeSchema,
   message: z.string(),
   installId: installIdSchema.optional(),
   path: z.string().optional(),
   detail: z.string().optional()
});

export const installSummarySchema = z.object({
   id: installIdSchema,
   name: z.string(),
   pinned: z.boolean(),
   version: z.string().nullable(),
   store: storeKindSchema.nullable(),
   source: installSourceSchema,
   path: z.string(),
   color: z.string().nullable(),
   status: installStatusSchema,
   createdAt: z.string(),
   updatedAt: z.string(),
   problem: installProblemSchema.optional()
});

export const installDetailSchema = installSummarySchema.extend({
   aliases: z.array(z.string())
});

export const installRegistrySnapshotSchema = z.object({
   installRoot: z.string(),
   scannedAt: z.string(),
   installs: z.array(installSummarySchema),
   problems: z.array(installProblemSchema)
});

export type InstallSource = z.infer<typeof installSourceSchema>;
export type InstallProblem = z.infer<typeof installProblemSchema>;
export type InstallSummary = z.infer<typeof installSummarySchema>;
export type InstallDetail = z.infer<typeof installDetailSchema>;
export type InstallRegistrySnapshot = z.infer<typeof installRegistrySnapshotSchema>;

export function createEmptyInstallRegistrySnapshot(installRoot: string): InstallRegistrySnapshot {
   return {
      installRoot,
      scannedAt: new Date().toISOString(),
      installs: [],
      problems: []
   };
}

export const installNameSchema = z.string().trim().min(1).max(60);
export const installColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const defaultInstallColor = '#a1f6d4';
export const installColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

export const installUpdateRequestSchema = z.object({
   installId: installIdSchema,
   name: installNameSchema.optional(),
   color: installColorSchema.nullable().optional(),
   path: z.string().trim().min(1).optional()
});

export const installPinRequestSchema = z.object({
   installId: installIdSchema,
   pinned: z.boolean()
});

export const installReorderRequestSchema = z.object({
   installIds: z
      .array(installIdSchema)
      .min(1)
      .refine((installIds) => new Set(installIds).size === installIds.length)
});

export const installActionRequestSchema = z.object({
   installId: installIdSchema
});

export type InstallActionRequest = { targetId: TargetId } & z.infer<typeof installActionRequestSchema>;
export type InstallDetailRequest = InstallActionRequest;

const installActionIssueSchema = z.enum([
   'inspect-failed',
   'invalid-color',
   'invalid-name',
   'holds-shared-library',
   'not-found',
   'store-detected',
   'store-owned',
   'unsupported-target'
]);

const installActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: installIdSchema,
   issue: installActionIssueSchema,
   detail: z.string().optional()
});

export const installDeletePreviewSchema = z.discriminatedUnion('status', [
   installActionProblemSchema,
   z.object({
      status: z.literal('ok'),
      installId: installIdSchema,
      name: z.string(),
      path: z.string(),
      source: installSourceSchema,
      sizeBytes: z.number(),
      fileCount: z.number()
   })
]);

export const installForgetPreviewSchema = z.discriminatedUnion('status', [
   installActionProblemSchema,
   z.object({
      status: z.literal('ok'),
      installId: installIdSchema,
      name: z.string(),
      path: z.string(),
      source: installSourceSchema
   })
]);

export const installDetailResultSchema = z.union([
   z.object({ ok: z.literal(true), value: installDetailSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

const installForgetOutcomeSchema = z.object({
   installId: installIdSchema,
   name: z.string(),
   path: z.string()
});

export const installForgetResultSchema = z.union([
   z.object({ ok: z.literal(true), value: installForgetOutcomeSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export const installRegistryResultSchema = z.union([
   z.object({ ok: z.literal(true), value: installRegistrySnapshotSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export type InstallActionIssue = z.infer<typeof installActionIssueSchema>;
export type InstallActionProblem = z.infer<typeof installActionProblemSchema>;
export type InstallDeletePreview = z.infer<typeof installDeletePreviewSchema>;
export type InstallForgetPreview = z.infer<typeof installForgetPreviewSchema>;

export type InstallUpdateRequest = { targetId: TargetId } & z.infer<typeof installUpdateRequestSchema>;

export type InstallRootIssue = 'empty' | 'inspect-failed' | 'not-a-directory' | 'not-absolute' | 'not-writable' | 'parent-missing' | 'unchanged';

export type InstallRootValidation = {
   path: string;
   exists: boolean;
   installCount: number;
} & ({ status: 'ok' } | { status: 'invalid'; issue: InstallRootIssue });

export type InstallRootChoice =
   | { status: 'cancelled' }
   | {
        status: 'selected';
        currentRoot: string;
        currentInstallCount: number;
        selected: InstallRootValidation;
     };

const installFolderIssueSchema = z.enum([
   'inspect-failed',
   'missing-executable',
   'missing-game-data',
   'not-a-directory',
   'not-absolute',
   'not-found',
   'unknown-version'
]);

export const installImportSourceSchema = z.object({ sourcePath: z.string().min(1) });

export const installImportPreviewSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('invalid'),
      sourcePath: z.string(),
      issue: z.union([z.literal('already-registered'), installFolderIssueSchema]),
      detail: z.string().optional()
   }),
   z.object({ status: z.literal('ok'), sourcePath: z.string(), version: z.string(), source: installSourceSchema })
]);

export type InstallFolderIssue = z.infer<typeof installFolderIssueSchema>;
export type InstallImportPreview = z.infer<typeof installImportPreviewSchema>;
export type InstallImportIssue = Extract<InstallImportPreview, { status: 'invalid' }>['issue'];
