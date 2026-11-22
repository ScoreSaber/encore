import { z } from 'zod';

import type { IpcResult } from '@/ipc/core';
import { installIdSchema } from '@/modules/installs/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';

export const modelTypeSchema = z.enum(['avatar', 'bloq', 'platform', 'saber', 'wall']);
export const modelTypes = modelTypeSchema.options;

export type ModelType = z.infer<typeof modelTypeSchema>;
export type CatalogModelType = Exclude<ModelType, 'wall'>;

export const modelSharedFolderIds = {
   avatar: 'avatars',
   bloq: 'notes',
   platform: 'platforms',
   saber: 'sabers',
   wall: null
};

export type ModelHash = string;

export type ModelId = string;

const modelSourceSchema = z.enum(['local', 'modelsaber']);

const modelProblemCodeSchema = z.enum(['models.file.unreadable', 'models.hash.failed', 'models.root.unreadable']);

const modelProblemSchema = z.object({
   code: modelProblemCodeSchema,
   message: z.string(),
   type: modelTypeSchema.optional(),
   fileName: z.string().optional(),
   detail: z.string().optional()
});

const modelCollectionStatusSchema = z.enum(['missing', 'ready', 'scanning', 'unsupported']);

export type ModelProblem = z.infer<typeof modelProblemSchema>;
type ModelCollectionStatus = z.infer<typeof modelCollectionStatusSchema>;

export const localModelSummarySchema = z.object({
   id: z.string(),
   type: modelTypeSchema,
   fileName: z.string(),
   path: z.string(),
   name: z.string(),
   author: z.string().nullable(),
   hash: z.string().nullable(),
   source: modelSourceSchema,
   thumbnailUrl: z.string().nullable(),
   sizeBytes: z.number(),
   updatedAt: z.string(),
   isDuplicate: z.boolean(),
   problem: modelProblemSchema.optional()
});

const modelFolderSummarySchema = z.object({
   type: modelTypeSchema,
   path: z.string(),
   exists: z.boolean()
});

export const modelCollectionSnapshotSchema = z.object({
   installId: z.string(),
   status: modelCollectionStatusSchema,
   installPath: z.string().nullable(),
   folders: z.array(modelFolderSummarySchema),
   models: z.array(localModelSummarySchema),
   problems: z.array(modelProblemSchema),
   progress: z.object({ scanned: z.number(), total: z.number() }).nullable(),
   scannedAt: z.string().nullable()
});

export type LocalModelSummary = z.infer<typeof localModelSummarySchema>;
export type ModelFolderSummary = z.infer<typeof modelFolderSummarySchema>;
export type ModelCollectionSnapshot = z.infer<typeof modelCollectionSnapshotSchema>;

export const modelCollectionRequestSchema = z.object({
   installId: installIdSchema
});
export const modelSelectionRequestSchema = modelCollectionRequestSchema.extend({
   modelIds: z.array(z.string().min(1))
});
const modelDetailRequestSchema = modelCollectionRequestSchema.extend({
   modelId: z.string().min(1)
});

type ModelCollectionRequest = z.infer<typeof modelCollectionRequestSchema>;
export type ModelSelectionRequest = z.infer<typeof modelSelectionRequestSchema>;
export type ModelDetailRequest = z.infer<typeof modelDetailRequestSchema>;

const modelActionIssueSchema = z.enum([
   'already-installed',
   'inspect-failed',
   'install-not-found',
   'models-missing',
   'no-selection',
   'no-source',
   'not-found',
   'source-unavailable',
   'unsupported-target',
   'unsupported-type'
]);

export type ModelActionIssue = z.infer<typeof modelActionIssueSchema>;

const modelActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   issue: modelActionIssueSchema,
   detail: z.string().optional()
});

const readyModelDeletePreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   names: z.array(z.string()),
   modelCount: z.number(),
   sizeBytes: z.number(),
   folders: z.array(z.string())
});

export const modelDeletePreviewSchema = z.discriminatedUnion('status', [modelActionProblemSchema, readyModelDeletePreviewSchema]);

export type ModelActionProblem = z.infer<typeof modelActionProblemSchema>;
export type ReadyModelDeletePreview = z.infer<typeof readyModelDeletePreviewSchema>;
export type ModelDeletePreview = z.infer<typeof modelDeletePreviewSchema>;

export type ModelOperationResult = IpcResult<OperationSnapshot>;

const modelAssetIdSchema = z
   .string()
   .regex(/^\d{1,16}$/)
   .refine((id) => Number(id) > 0 && Number.isSafeInteger(Number(id)));

const modelDownloadSourceSchema = z.object({
   kind: z.literal('modelsaber'),
   id: modelAssetIdSchema
});

export type ModelDownloadSource = z.infer<typeof modelDownloadSourceSchema>;

const modelSearchIssueSchema = z.enum(['fetch-failed', 'invalid-response', 'unsupported', 'unsupported-type']);

export type ModelSearchIssue = z.infer<typeof modelSearchIssueSchema>;

const catalogModelSummarySchema = z.object({
   id: z.string(),
   type: modelTypeSchema,
   name: z.string(),
   author: z.string(),
   hash: z.string(),
   thumbnailUrl: z.string().nullable(),
   tags: z.array(z.string()),
   publishedAt: z.string().nullable(),
   installed: z.boolean()
});

export const modelSearchResultSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('ok'),
      type: modelTypeSchema,
      query: z.string(),
      page: z.number(),
      models: z.array(catalogModelSummarySchema),
      hasMore: z.boolean()
   }),
   z.object({
      status: z.literal('failed'),
      issue: modelSearchIssueSchema,
      detail: z.string().optional()
   })
]);

export type CatalogModelSummary = z.infer<typeof catalogModelSummarySchema>;
export type ModelSearchResult = z.infer<typeof modelSearchResultSchema>;

export const modelSearchRequestSchema = modelCollectionRequestSchema.extend({
   type: modelTypeSchema,
   query: z.string(),
   page: z.int().nonnegative().optional()
});
export const modelDownloadRequestSchema = modelCollectionRequestSchema.extend({
   source: modelDownloadSourceSchema
});

export type ModelSearchRequest = z.infer<typeof modelSearchRequestSchema>;
export type ModelDownloadRequest = z.infer<typeof modelDownloadRequestSchema>;

export type ModelImportRequest = ModelCollectionRequest & {
   paths: string[];
};

export type ModelExportRequest = ModelSelectionRequest & {
   destinationPath: string;
};

export const modelLinkScheme = 'modelsaber';

const modelLinkIssueSchema = z.enum(['invalid-id', 'unsupported-link']);

type ModelLinkIssue = z.infer<typeof modelLinkIssueSchema>;

type ModelLinkParse = { status: 'ok'; id: string } | { status: 'invalid'; issue: ModelLinkIssue };

export type ModelLinkEvent =
   | { status: 'ready'; id: string; model: CatalogModelSummary | null }
   | { status: 'rejected'; issue: ModelLinkIssue; detail?: string };

export function isCatalogModelType(type: ModelType) {
   return type !== 'wall';
}

export function parseModelLink(value: string): ModelLinkParse {
   const url = URL.canParse(value) ? new URL(value) : null;
   if (!url || url.protocol.slice(0, -1).toLowerCase() !== modelLinkScheme) return { status: 'invalid', issue: 'unsupported-link' };

   const [first, second] = `${url.host}${url.pathname}`.split('/').filter(Boolean);
   const isTypedLink = first === 'note_bloq' || modelTypeSchema.safeParse(first).success;
   const id = modelAssetIdSchema.safeParse(isTypedLink ? second : first);
   if (!id.success || url.username || url.password) return { status: 'invalid', issue: 'invalid-id' };

   return { status: 'ok', id: id.data };
}

export function invalidModelAction(request: ModelCollectionRequest, issue: ModelActionIssue, detail?: string): ModelActionProblem {
   const problem: ModelActionProblem = { status: 'invalid', installId: request.installId, issue };
   if (detail) problem.detail = detail;
   return problem;
}

export function createEmptyModelCollectionSnapshot(
   request: ModelCollectionRequest,
   status: ModelCollectionStatus = 'scanning'
): ModelCollectionSnapshot {
   return {
      installId: request.installId,
      status,
      installPath: null,
      folders: [],
      models: [],
      problems: [],
      progress: null,
      scannedAt: null
   };
}
