import { z } from 'zod';

import type { IpcResult } from '@/app/ipc/core';
import { installIdSchema } from '@/modules/installs/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';

export type MapHash = string;

export type MapId = string;

export const mapProblemCodeSchema = z.enum([
   'maps.export.cancelled',
   'maps.export.failed',
   'maps.folder.unreadable',
   'maps.hash.failed',
   'maps.info.invalid',
   'maps.info.missing',
   'maps.info.unsafe-filename',
   'maps.info.unsupported-version',
   'maps.root.unreadable'
]);

export const mapProblemSchema = z.object({
   code: mapProblemCodeSchema,
   message: z.string(),
   folderName: z.string().optional(),
   detail: z.string().optional()
});

export const mapCollectionStatusSchema = z.enum(['missing', 'ready', 'scanning', 'unsupported']);

export type MapProblemCode = z.infer<typeof mapProblemCodeSchema>;
export type MapProblem = z.infer<typeof mapProblemSchema>;
export type MapCollectionStatus = z.infer<typeof mapCollectionStatusSchema>;

export const mapDifficultySummarySchema = z.object({
   characteristic: z.string(),
   difficulty: z.string()
});

export const localMapSummarySchema = z.object({
   id: z.string(),
   folderName: z.string(),
   path: z.string(),
   hash: z.string().nullable(),
   title: z.string(),
   subTitle: z.string(),
   artist: z.string(),
   mappers: z.array(z.string()),
   bpm: z.number().nullable(),
   durationSeconds: z.number().nullable(),
   difficulties: z.array(mapDifficultySummarySchema),
   coverFileName: z.string().nullable(),
   sizeBytes: z.number(),
   updatedAt: z.string(),
   isDuplicate: z.boolean(),
   problem: mapProblemSchema.optional()
});

export const mapCollectionSnapshotSchema = z.object({
   installId: z.string(),
   status: mapCollectionStatusSchema,
   mapsPath: z.string().nullable(),
   scannedAt: z.string().nullable(),
   maps: z.array(localMapSummarySchema),
   problems: z.array(mapProblemSchema),
   progress: z.object({ scanned: z.number(), total: z.number() }).nullable()
});

export type MapDifficultySummary = z.infer<typeof mapDifficultySummarySchema>;
export type LocalMapSummary = z.infer<typeof localMapSummarySchema>;
export type MapCollectionSnapshot = z.infer<typeof mapCollectionSnapshotSchema>;

export const mapCollectionRequestSchema = z.object({
   installId: installIdSchema
});
export const mapSelectionRequestSchema = mapCollectionRequestSchema.extend({
   mapIds: z.array(z.string().min(1))
});
export const mapDetailRequestSchema = mapCollectionRequestSchema.extend({
   mapId: z.string().min(1)
});

export type MapCollectionRequest = z.infer<typeof mapCollectionRequestSchema>;
export type MapSelectionRequest = z.infer<typeof mapSelectionRequestSchema>;
export type MapDetailRequest = z.infer<typeof mapDetailRequestSchema>;

export const mapCoverResultSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('ok'), dataUrl: z.string() }),
   z.object({ status: z.literal('unavailable') }),
   z.object({ status: z.literal('unsupported') })
]);

export type MapCoverResult = z.infer<typeof mapCoverResultSchema>;

export type MapOpenFolderResult = { status: 'opened' } | { status: 'unsupported' } | { status: 'failed'; message: string };

export const mapActionIssueSchema = z.enum([
   'already-installed',
   'install-not-found',
   'inspect-failed',
   'maps-missing',
   'no-selection',
   'no-source',
   'not-found',
   'source-unavailable',
   'unsupported-target'
]);

export type MapActionIssue = z.infer<typeof mapActionIssueSchema>;

export const mapActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   issue: mapActionIssueSchema,
   detail: z.string().optional()
});

export const readyMapDeletePreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   mapsPath: z.string(),
   names: z.array(z.string()),
   mapCount: z.number(),
   sizeBytes: z.number(),
   fileCount: z.number()
});

export const mapDeletePreviewSchema = z.discriminatedUnion('status', [mapActionProblemSchema, readyMapDeletePreviewSchema]);

export type MapActionProblem = z.infer<typeof mapActionProblemSchema>;
export type ReadyMapDeletePreview = z.infer<typeof readyMapDeletePreviewSchema>;
export type MapDeletePreview = z.infer<typeof mapDeletePreviewSchema>;

export type MapOperationResult = IpcResult<OperationSnapshot>;

export const mapDownloadSourceSchema = z.object({
   kind: z.literal('beatsaver'),
   key: z.string().min(1)
});

export type MapDownloadSource = z.infer<typeof mapDownloadSourceSchema>;

export const mapSearchIssueSchema = z.enum(['fetch-failed', 'invalid-response', 'unsupported']);

export type MapSearchIssue = z.infer<typeof mapSearchIssueSchema>;

export const beatSaverMapSummarySchema = z.object({
   key: z.string(),
   hash: z.string(),
   title: z.string(),
   subTitle: z.string(),
   artist: z.string(),
   mapper: z.string(),
   bpm: z.number().nullable(),
   durationSeconds: z.number().nullable(),
   upvotes: z.number(),
   downvotes: z.number(),
   ranked: z.boolean(),
   curated: z.boolean(),
   automapper: z.boolean(),
   publishedAt: z.string().nullable(),
   difficulties: z.array(mapDifficultySummarySchema),
   coverUrl: z.string().nullable(),
   installed: z.boolean()
});

export const mapSearchResultSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('ok'),
      query: z.string(),
      page: z.number(),
      maps: z.array(beatSaverMapSummarySchema),
      hasMore: z.boolean()
   }),
   z.object({
      status: z.literal('failed'),
      issue: mapSearchIssueSchema,
      detail: z.string().optional()
   })
]);

export type BeatSaverMapSummary = z.infer<typeof beatSaverMapSummarySchema>;
export type MapSearchResult = z.infer<typeof mapSearchResultSchema>;

export const mapSearchRequestSchema = mapCollectionRequestSchema.extend({
   query: z.string(),
   page: z.int().nonnegative().optional()
});
export const mapDownloadRequestSchema = mapCollectionRequestSchema.extend({
   source: mapDownloadSourceSchema
});

export type MapSearchRequest = z.infer<typeof mapSearchRequestSchema>;
export type MapDownloadRequest = z.infer<typeof mapDownloadRequestSchema>;

export type MapImportChoice = { status: 'selected'; paths: string[] } | { status: 'cancelled' } | { status: 'unsupported' };

export type MapImportRequest = MapCollectionRequest & {
   paths: string[];
};

export type MapExportChoice = { status: 'selected'; path: string } | { status: 'cancelled' } | { status: 'unsupported' };

export type MapExportRequest = MapSelectionRequest & {
   destinationPath: string;
};

export const mapLinkSchemeSchema = z.enum(['beatsaver', 'web+bsmap']);
export const mapLinkSchemes = mapLinkSchemeSchema.options;

export type MapLinkScheme = z.infer<typeof mapLinkSchemeSchema>;

export const mapLinkIssueSchema = z.enum(['invalid-key', 'unsupported-link']);

export type MapLinkIssue = z.infer<typeof mapLinkIssueSchema>;

export type MapLinkParse = { status: 'ok'; scheme: MapLinkScheme; key: string } | { status: 'invalid'; issue: MapLinkIssue };

export type MapLinkEvent =
   | { status: 'ready'; key: string; map: BeatSaverMapSummary | null }
   | { status: 'rejected'; issue: MapLinkIssue; detail?: string };

export type MapLinkProtocolState = {
   schemes: MapLinkScheme[];
   registered: boolean;
   canUnregister: boolean;
};

export type MapLinkProtocolResult = IpcResult<MapLinkProtocolState>;

export function parseMapLink(value: string): MapLinkParse {
   const url = URL.canParse(value) ? new URL(value) : null;
   if (!url) return { status: 'invalid', issue: 'unsupported-link' };

   const scheme = mapLinkSchemeSchema.safeParse(url.protocol.slice(0, -1));
   if (!scheme.success) return { status: 'invalid', issue: 'unsupported-link' };

   const key = (url.host || url.pathname).replaceAll('/', '').trim().toLowerCase();
   if (!/^[\da-z]{1,16}$/.test(key)) return { status: 'invalid', issue: 'invalid-key' };

   return { status: 'ok', scheme: scheme.data, key };
}

export function invalidMapAction(request: MapCollectionRequest, issue: MapActionIssue, detail?: string): MapActionProblem {
   return {
      status: 'invalid',
      installId: request.installId,
      issue,
      ...(detail ? { detail } : {})
   };
}

export function createEmptyMapCollectionSnapshot(request: MapCollectionRequest, status: MapCollectionStatus = 'scanning'): MapCollectionSnapshot {
   return {
      installId: request.installId,
      status,
      mapsPath: null,
      scannedAt: null,
      maps: [],
      problems: [],
      progress: null
   };
}
