import { z } from 'zod';

import type { IpcResult } from '@/app/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import { mapDifficultySummarySchema } from '@/modules/maps/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';

export type PlaylistId = string;

export const playlistProblemCodeSchema = z.enum([
   'playlists.export.cancelled',
   'playlists.export.failed',
   'playlists.file.invalid',
   'playlists.file.too-large',
   'playlists.file.unreadable',
   'playlists.root.unreadable',
   'playlists.source.unreadable',
   'playlists.write.failed'
]);

export const playlistProblemSchema = z.object({
   code: playlistProblemCodeSchema,
   message: z.string(),
   fileName: z.string().optional(),
   detail: z.string().optional()
});

export const playlistCollectionStatusSchema = z.enum(['missing', 'ready', 'scanning', 'unsupported']);

export type PlaylistProblemCode = z.infer<typeof playlistProblemCodeSchema>;
export type PlaylistProblem = z.infer<typeof playlistProblemSchema>;
export type PlaylistCollectionStatus = z.infer<typeof playlistCollectionStatusSchema>;

export const playlistSongRefSchema = z.object({
   hash: z.string().nullable(),
   key: z.string().nullable(),
   songName: z.string(),
   levelAuthorName: z.string(),
   difficulties: z.array(mapDifficultySummarySchema),
   installed: z.boolean()
});

export const localPlaylistSummarySchema = z.object({
   id: z.string(),
   fileName: z.string(),
   path: z.string(),
   title: z.string(),
   author: z.string(),
   description: z.string(),
   songCount: z.number(),
   missingCount: z.number(),
   syncUrl: z.string().nullable(),
   sizeBytes: z.number(),
   updatedAt: z.string(),
   problem: playlistProblemSchema.optional()
});

export const playlistDetailSchema = localPlaylistSummarySchema.extend({
   songs: z.array(playlistSongRefSchema)
});

export const playlistCollectionSnapshotSchema = z.object({
   installId: z.string(),
   status: playlistCollectionStatusSchema,
   playlistsPath: z.string().nullable(),
   scannedAt: z.string().nullable(),
   playlists: z.array(localPlaylistSummarySchema),
   problems: z.array(playlistProblemSchema),
   progress: z.object({ scanned: z.number(), total: z.number() }).nullable()
});

export type PlaylistSongRef = z.infer<typeof playlistSongRefSchema>;
export type LocalPlaylistSummary = z.infer<typeof localPlaylistSummarySchema>;
export type PlaylistDetail = z.infer<typeof playlistDetailSchema>;
export type PlaylistCollectionSnapshot = z.infer<typeof playlistCollectionSnapshotSchema>;

export type PlaylistCollectionRequest = {
   installId: InstallId;
};

export type PlaylistSelectionRequest = PlaylistCollectionRequest & {
   playlistIds: PlaylistId[];
};

export type PlaylistDetailRequest = PlaylistCollectionRequest & {
   playlistId: PlaylistId;
};

export type PlaylistDeleteRequest = PlaylistSelectionRequest & {
   deleteMaps?: boolean;
};

export type PlaylistOpenFolderResult = { status: 'opened' } | { status: 'unsupported' } | { status: 'failed'; message: string };

export const playlistActionIssueSchema = z.enum([
   'install-not-found',
   'inspect-failed',
   'invalid-source',
   'no-missing-maps',
   'no-selection',
   'no-source',
   'not-found',
   'playlists-missing',
   'source-unavailable',
   'unsupported-target'
]);

export type PlaylistActionIssue = z.infer<typeof playlistActionIssueSchema>;

export const playlistActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   issue: playlistActionIssueSchema,
   detail: z.string().optional()
});

export const readyPlaylistDeletePreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   playlistsPath: z.string(),
   names: z.array(z.string()),
   playlistCount: z.number(),
   sizeBytes: z.number(),
   deleteMaps: z.boolean(),
   mapNames: z.array(z.string()),
   mapCount: z.number(),
   mapSizeBytes: z.number()
});

export const playlistDeletePreviewSchema = z.discriminatedUnion('status', [playlistActionProblemSchema, readyPlaylistDeletePreviewSchema]);

export type PlaylistActionProblem = z.infer<typeof playlistActionProblemSchema>;
export type ReadyPlaylistDeletePreview = z.infer<typeof readyPlaylistDeletePreviewSchema>;
export type PlaylistDeletePreview = z.infer<typeof playlistDeletePreviewSchema>;

export type PlaylistOperationResult = IpcResult<OperationSnapshot>;

export type PlaylistDownloadRequest = PlaylistCollectionRequest & {
   url: string;
};

export type PlaylistImportChoice = { status: 'selected'; paths: string[] } | { status: 'cancelled' } | { status: 'unsupported' };

export type PlaylistImportRequest = PlaylistCollectionRequest & {
   paths: string[];
};

export type PlaylistExportChoice = { status: 'selected'; path: string } | { status: 'cancelled' } | { status: 'unsupported' };

export type PlaylistExportRequest = PlaylistSelectionRequest & {
   destinationPath: string;
};

export const playlistLinkScheme = 'bsplaylist';
export const playlistFileExtension = '.bplist';

const playlistLinkIssueSchema = z.enum(['invalid-source', 'unsupported-link']);

export type PlaylistLinkIssue = z.infer<typeof playlistLinkIssueSchema>;

export type PlaylistLinkSource = { kind: 'url'; url: string } | { kind: 'file'; path: string; fileName: string };

export type PlaylistLinkParse = { status: 'ok'; url: string } | { status: 'invalid'; issue: PlaylistLinkIssue };

export type PlaylistLinkEvent = { status: 'ready'; source: PlaylistLinkSource } | { status: 'rejected'; issue: PlaylistLinkIssue; detail?: string };

export type PlaylistLinkProtocolState = {
   scheme: string;
   registered: boolean;
   canUnregister: boolean;
};

export type PlaylistLinkProtocolResult = IpcResult<PlaylistLinkProtocolState>;

export function parsePlaylistLink(value: string): PlaylistLinkParse {
   const url = URL.canParse(value) ? new URL(value) : null;
   if (!url || url.protocol.slice(0, -1) !== playlistLinkScheme) return { status: 'invalid', issue: 'unsupported-link' };
   if (url.host !== 'playlist') return { status: 'invalid', issue: 'invalid-source' };

   const rawSource = `${url.pathname.replace(/^\//, '')}${url.search}`;
   const source = [rawSource, decodeLinkSource(rawSource)].find(
      (candidate) => candidate && URL.canParse(candidate) && new URL(candidate).protocol === 'https:'
   );
   if (!source) return { status: 'invalid', issue: 'invalid-source' };

   return { status: 'ok', url: source };
}

export function invalidPlaylistAction(request: PlaylistCollectionRequest, issue: PlaylistActionIssue, detail?: string): PlaylistActionProblem {
   return {
      status: 'invalid',
      installId: request.installId,
      issue,
      ...(detail ? { detail } : {})
   };
}

export function createEmptyPlaylistCollectionSnapshot(
   request: PlaylistCollectionRequest,
   status: PlaylistCollectionStatus = 'scanning'
): PlaylistCollectionSnapshot {
   return {
      installId: request.installId,
      status,
      playlistsPath: null,
      scannedAt: null,
      playlists: [],
      problems: [],
      progress: null
   };
}

function decodeLinkSource(raw: string) {
   try {
      return decodeURIComponent(raw);
   } catch {
      return null;
   }
}
