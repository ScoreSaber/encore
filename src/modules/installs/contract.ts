import { z } from 'zod';

import type { IpcResult } from '@/app/ipc/core';
import { operationErrorSchema, operationResultSchema, type OperationSnapshot } from '@/modules/operations/contract';
import { storeKindSchema } from '@/modules/stores/contract';
import type { TargetId } from '@/modules/targets/contract';

export const installIdSchema = z.string().min(1);

export type InstallId = string;

export const installSourceSchema = z.enum(['bsmanager', 'imported', 'library', 'store']);
export const installStatusSchema = z.enum(['incomplete', 'missing', 'ready']);

export const installProblemCodeSchema = z.enum(['install.path.unreadable', 'install.registry.write-failed', 'install.version.unknown']);

export const installProblemSchema = z.object({
   code: installProblemCodeSchema,
   message: z.string(),
   installId: z.string().optional(),
   path: z.string().optional(),
   detail: z.string().optional()
});

export const installSummarySchema = z.object({
   id: z.string(),
   name: z.string(),
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
   aliases: z.array(z.string()),
   appId: z.string().optional(),
   libraryPath: z.string().optional(),
   manifestPath: z.string().optional(),
   executablePath: z.string().optional()
});

export const installRegistrySnapshotSchema = z.object({
   installRoot: z.string(),
   scannedAt: z.string(),
   installs: z.array(installSummarySchema),
   problems: z.array(installProblemSchema)
});

export type InstallSource = z.infer<typeof installSourceSchema>;
export type InstallProblemCode = z.infer<typeof installProblemCodeSchema>;
export type InstallProblem = z.infer<typeof installProblemSchema>;
export type InstallSummary = z.infer<typeof installSummarySchema>;
export type InstallDetail = z.infer<typeof installDetailSchema>;
export type InstallRegistrySnapshot = z.infer<typeof installRegistrySnapshotSchema>;
export type TargetInstallRegistrySnapshot = { targetId: TargetId } & InstallRegistrySnapshot;

export type InstallActionRequest = {
   targetId: TargetId;
   installId: InstallId;
};

export type InstallDetailRequest = InstallActionRequest;

export const installNameSchema = z.string().trim().min(1).max(60);
export const installColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const installColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];

export const installUpdateRequestSchema = z.object({
   installId: z.string().min(1),
   name: installNameSchema.optional(),
   color: installColorSchema.nullable().optional()
});

export const installActionRequestSchema = z.object({
   installId: z.string().min(1)
});

export const installActionIssueSchema = z.enum([
   'inspect-failed',
   'invalid-color',
   'invalid-name',
   'not-found',
   'store-detected',
   'store-owned',
   'unsupported-target'
]);

export const installActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   issue: installActionIssueSchema,
   detail: z.string().optional()
});

export const installDeletePreviewSchema = z.discriminatedUnion('status', [
   installActionProblemSchema,
   z.object({
      status: z.literal('ok'),
      installId: z.string(),
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
      installId: z.string(),
      name: z.string(),
      path: z.string(),
      source: installSourceSchema
   })
]);

export const installDetailResultSchema = z.union([
   z.object({ ok: z.literal(true), value: installDetailSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export const installForgetOutcomeSchema = z.object({
   installId: z.string(),
   name: z.string(),
   path: z.string()
});

export const installForgetResultSchema = z.union([
   z.object({ ok: z.literal(true), value: installForgetOutcomeSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export const installOperationResultSchema = operationResultSchema;

export type InstallActionIssue = z.infer<typeof installActionIssueSchema>;
export type InstallActionProblem = z.infer<typeof installActionProblemSchema>;
export type InstallDeletePreview = z.infer<typeof installDeletePreviewSchema>;
export type InstallForgetPreview = z.infer<typeof installForgetPreviewSchema>;
export type InstallForgetOutcome = z.infer<typeof installForgetOutcomeSchema>;
export type InstallForgetResult = IpcResult<InstallForgetOutcome>;
export type InstallUpdateResult = IpcResult<InstallDetail>;
export type InstallOperationResult = IpcResult<OperationSnapshot>;

export type InstallUpdateRequest = InstallActionRequest & {
   name?: string;
   color?: string | null;
};

export type InstallOpenFolderResult = { status: 'opened' } | { status: 'unsupported' } | { status: 'failed'; message: string };

export function invalidInstallAction(request: { installId: InstallId }, issue: InstallActionIssue, detail?: string): InstallActionProblem {
   return {
      status: 'invalid',
      installId: request.installId,
      issue,
      ...(detail ? { detail } : {})
   };
}

export type InstallRootIssue = 'empty' | 'inspect-failed' | 'not-a-directory' | 'not-absolute' | 'not-writable' | 'parent-missing' | 'unchanged';

export type InstallRootValidation = {
   path: string;
   status: 'ok' | 'invalid';
   exists: boolean;
   installCount: number;
   issue?: InstallRootIssue;
};

export type InstallRootChoice =
   | { status: 'cancelled' }
   | {
        status: 'selected';
        currentRoot: string;
        currentInstallCount: number;
        selected: InstallRootValidation;
     };

export type InstallImportIssue =
   | 'already-registered'
   | 'inspect-failed'
   | 'missing-executable'
   | 'missing-game-data'
   | 'not-a-directory'
   | 'not-absolute'
   | 'not-found'
   | 'unknown-version';

export type InstallImportPreview =
   | {
        status: 'invalid';
        targetId: TargetId;
        sourcePath: string;
        issue: InstallImportIssue;
        detail?: string;
     }
   | {
        status: 'ok';
        targetId: TargetId;
        sourcePath: string;
        version: string;
        source: InstallSource;
     };

export type InstallImportChoice = { status: 'cancelled' } | { status: 'unsupported' } | { status: 'selected'; preview: InstallImportPreview };

export type InstallImportRequest = {
   targetId: TargetId;
   sourcePath: string;
};

export type InstallImportResult = IpcResult<InstallDetail>;
