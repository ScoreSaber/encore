import { z } from 'zod';

import { installIdSchema } from '@/modules/installs/contract';
import { operationErrorSchema } from '@/modules/operations/contract';
import { customSharedFolderSchema, sharedFolderIdSchema, sharedFolderLinkStateSchema } from '@/modules/shared-content/contract';
import { storeKindSchema } from '@/modules/stores/contract';

const bsmanagerIssueSchema = z.enum([
   'inspect-failed',
   'not-bsmanager',
   'not-found',
   'nothing-selected',
   'nothing-to-clean',
   'nothing-to-adopt',
   'register-failed',
   'unsupported-target'
]);

export type BSManagerIssue = z.infer<typeof bsmanagerIssueSchema>;

export const bsmanagerDetectionSchema = z.object({
   status: z.enum(['detected', 'missing', 'unsupported']),
   rootPath: z.string().nullable(),
   sharedContentPath: z.string().nullable(),
   searchedPaths: z.array(z.string())
});

const bsmanagerFolderLinkSchema = z.object({
   id: sharedFolderIdSchema,
   relativePath: z.string(),
   state: sharedFolderLinkStateSchema,
   linkTargetPath: z.string().nullable()
});

const bsmanagerVersionSchema = z.object({
   id: z.string(),
   name: z.string().nullable(),
   version: z.string(),
   path: z.string(),
   store: storeKindSchema.nullable(),
   color: z.string().nullable(),
   status: z.enum(['adopted', 'missing', 'ready']),
   installId: installIdSchema.nullable(),
   folders: z.array(bsmanagerFolderLinkSchema)
});

const readyBSManagerPlanSchema = z.object({
   status: z.literal('ok'),
   rootPath: z.string(),
   versionsPath: z.string(),
   sharedContentPath: z.string(),
   currentSharedRootPath: z.string(),
   sharedRootAdopted: z.boolean(),
   useSymlinks: z.boolean(),
   customFolders: z.array(customSharedFolderSchema),
   versions: z.array(bsmanagerVersionSchema)
});

const bsmanagerPlanProblemSchema = z.object({
   status: z.literal('invalid'),
   rootPath: z.string(),
   issue: bsmanagerIssueSchema,
   detail: z.string().optional()
});

export const bsmanagerPlanSchema = z.discriminatedUnion('status', [readyBSManagerPlanSchema, bsmanagerPlanProblemSchema]);

const bsmanagerAdoptionOutcomeSchema = z.object({
   rootPath: z.string(),
   sharedRootPath: z.string(),
   adopted: z.number().int().nonnegative(),
   skipped: z.number().int().nonnegative()
});

export const bsmanagerAdoptResultSchema = z.union([
   z.object({ ok: z.literal(true), value: bsmanagerAdoptionOutcomeSchema }),
   z.object({ ok: z.literal(false), error: operationErrorSchema })
]);

export const bsmanagerAdoptInputSchema = z.object({
   rootPath: z.string().min(1),
   versionIds: z.array(z.string().min(1)),
   adoptSharedRoot: z.boolean()
});

export const bsmanagerCleanupInputSchema = z.object({ rootPath: z.string().min(1) });

export type BSManagerDetection = z.infer<typeof bsmanagerDetectionSchema>;
export type BSManagerFolderLink = z.infer<typeof bsmanagerFolderLinkSchema>;
export type BSManagerVersion = z.infer<typeof bsmanagerVersionSchema>;
export type ReadyBSManagerPlan = z.infer<typeof readyBSManagerPlanSchema>;
export type BSManagerPlanProblem = z.infer<typeof bsmanagerPlanProblemSchema>;
export type BSManagerPlan = z.infer<typeof bsmanagerPlanSchema>;
export type BSManagerAdoptionOutcome = z.infer<typeof bsmanagerAdoptionOutcomeSchema>;
export type BSManagerAdoptInput = z.infer<typeof bsmanagerAdoptInputSchema>;
export type BSManagerCleanupInput = z.infer<typeof bsmanagerCleanupInputSchema>;

export function invalidBSManagerPlan(rootPath: string, issue: BSManagerIssue, detail?: string): BSManagerPlanProblem {
   const problem: BSManagerPlanProblem = { status: 'invalid', rootPath, issue };
   if (detail) problem.detail = detail;
   return problem;
}
