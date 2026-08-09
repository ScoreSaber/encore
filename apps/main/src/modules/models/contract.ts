import { z } from 'zod';

import type { IpcResult } from '@/ipc/core';
import { installIdSchema } from '@/modules/installs/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';
import type { SharedFolderId } from '@/modules/shared-content/contract';

export const modelTypeSchema = z.enum(['avatar', 'bloq', 'platform', 'saber', 'wall']);
export const modelTypes = modelTypeSchema.options;

export type ModelType = z.infer<typeof modelTypeSchema>;
export type CatalogModelType = Exclude<ModelType, 'wall'>;

export const modelSharedFolderIds: Record<ModelType, SharedFolderId | null> = {
   avatar: 'avatars',
   bloq: 'notes',
   platform: 'platforms',
   saber: 'sabers',
   wall: null
};

export type ModelHash = string;

export type ModelId = string;

export const modelSourceSchema = z.enum(['local', 'modelsaber']);

export const modelProblemCodeSchema = z.enum([
   'models.export.cancelled',
   'models.export.failed',
   'models.file.unreadable',
   'models.file.unsupported-type',
   'models.hash.failed',
   'models.import.rejected',
   'models.root.unreadable'
]);

export const modelProblemSchema = z.object({
   code: modelProblemCodeSchema,
   message: z.string(),
   type: modelTypeSchema.optional(),
   fileName: z.string().optional(),
   detail: z.string().optional()
});

export const modelCollectionStatusSchema = z.enum(['missing', 'ready', 'scanning', 'unsupported']);

export type ModelProblemCode = z.infer<typeof modelProblemCodeSchema>;
export type ModelProblem = z.infer<typeof modelProblemSchema>;
export type ModelCollectionStatus = z.infer<typeof modelCollectionStatusSchema>;

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

export const modelFolderSummarySchema = z.object({
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

export type ModelCollectionRequest = z.infer<typeof modelCollectionRequestSchema>;
export type ModelSelectionRequest = z.infer<typeof modelSelectionRequestSchema>;
export type ModelDetailRequest = z.infer<typeof modelDetailRequestSchema>;

export type ModelOpenFolderResult = { status: 'opened' } | { status: 'unsupported' } | { status: 'failed'; message: string };

export const modelActionIssueSchema = z.enum([
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

export const modelActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   issue: modelActionIssueSchema,
   detail: z.string().optional()
});

export const readyModelDeletePreviewSchema = z.object({
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

export const modelDownloadSourceSchema = z.object({
   kind: z.literal('modelsaber'),
   id: z.string().min(1)
});

export type ModelDownloadSource = z.infer<typeof modelDownloadSourceSchema>;

export const modelSearchIssueSchema = z.enum(['fetch-failed', 'invalid-response', 'unsupported', 'unsupported-type']);

export type ModelSearchIssue = z.infer<typeof modelSearchIssueSchema>;

export const modelSaberModelSummarySchema = z.object({
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
      models: z.array(modelSaberModelSummarySchema),
      hasMore: z.boolean()
   }),
   z.object({
      status: z.literal('failed'),
      issue: modelSearchIssueSchema,
      detail: z.string().optional()
   })
]);

export type ModelSaberModelSummary = z.infer<typeof modelSaberModelSummarySchema>;
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

export type ModelImportChoice = { status: 'selected'; paths: string[] } | { status: 'cancelled' } | { status: 'unsupported' };

export type ModelImportRequest = ModelCollectionRequest & {
   paths: string[];
};

export type ModelExportChoice = { status: 'selected'; path: string } | { status: 'cancelled' } | { status: 'unsupported' };

export type ModelExportRequest = ModelSelectionRequest & {
   destinationPath: string;
};

export const modelLinkScheme = 'modelsaber';

const modelLinkIssueSchema = z.enum(['invalid-id', 'unsupported-link']);

export type ModelLinkIssue = z.infer<typeof modelLinkIssueSchema>;

export type ModelLinkParse = { status: 'ok'; id: string } | { status: 'invalid'; issue: ModelLinkIssue };

export type ModelLinkEvent =
   | { status: 'ready'; id: string; model: ModelSaberModelSummary | null }
   | { status: 'rejected'; issue: ModelLinkIssue; detail?: string };

export type ModelLinkProtocolState = {
   scheme: string;
   registered: boolean;
   canUnregister: boolean;
};

export type ModelLinkProtocolResult = IpcResult<ModelLinkProtocolState>;

export function isCatalogModelType(type: ModelType): type is CatalogModelType {
   return type !== 'wall';
}

export function parseModelLink(value: string): ModelLinkParse {
   const url = URL.canParse(value) ? new URL(value) : null;
   if (!url || url.protocol.slice(0, -1).toLowerCase() !== modelLinkScheme) return { status: 'invalid', issue: 'unsupported-link' };

   const id = `${url.host}${url.pathname}`.split('/').filter(Boolean).at(0)?.trim() ?? '';
   if (!/^\d{1,12}$/.test(id)) return { status: 'invalid', issue: 'invalid-id' };

   return { status: 'ok', id };
}

export function invalidModelAction(request: ModelCollectionRequest, issue: ModelActionIssue, detail?: string): ModelActionProblem {
   return {
      status: 'invalid',
      installId: request.installId,
      issue,
      ...(detail ? { detail } : {})
   };
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
