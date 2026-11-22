import { z } from 'zod';

import type { InstallId } from '@/modules/installs/contract';
import { operationErrorSchema, operationSnapshotSchema } from '@/modules/operations/contract';
import { storeKindSchema, type StoreKind } from '@/modules/stores/contract';

export const defaultVersionCatalogUrl = 'https://encore.scoresaber.com/versions/beat-saber.json';
const steamManifestIdSchema = z.string().regex(/^\d+$/);

export const downloadVersionSchema = z.object({
   version: z.string(),
   manifestId: steamManifestIdSchema,
   oculusBinaryId: z.string().nullable().default(null),
   releaseUrl: z.string().nullable(),
   releaseDate: z.string().nullable(),
   year: z.string().nullable(),
   recommended: z.boolean()
});

const downloadCatalogSourceSchema = z.enum(['cache', 'remote']);

const downloadCatalogProblemCodeSchema = z.enum([
   'downloads.catalog.empty',
   'downloads.catalog.fetch-failed',
   'downloads.catalog.invalid',
   'downloads.catalog.write-failed'
]);

const downloadCatalogProblemSchema = z.object({
   code: downloadCatalogProblemCodeSchema,
   message: z.string(),
   detail: z.string().optional()
});

export const downloadCatalogCacheVersion = 2;

export const downloadCatalogCacheSchema = z.object({
   schemaVersion: z.literal(downloadCatalogCacheVersion),
   sourceUrl: z.string(),
   updatedAt: z.string(),
   versions: z.array(downloadVersionSchema)
});

const downloadCatalogSnapshotSchema = z.object({
   status: z.enum(['ready', 'unavailable']),
   source: downloadCatalogSourceSchema.nullable(),
   sourceUrl: z.string(),
   updatedAt: z.string().nullable(),
   versions: z.array(downloadVersionSchema),
   problem: downloadCatalogProblemSchema.optional()
});

export const targetDownloadCatalogSchema = downloadCatalogSnapshotSchema.extend({ stores: z.array(storeKindSchema).default(['steam', 'oculus']) });

const downloadIssueSchema = z.enum([
   'binary-unavailable',
   'catalog-unavailable',
   'depot-not-empty',
   'inspect-failed',
   'steam-missing',
   'steam-signed-out',
   'unknown-version',
   'unsupported-platform',
   'unsupported-target'
]);

const downloadWarningSchema = z.enum(['depot-not-empty', 'meta-sign-in-opens', 'name-conflict', 'steam-console-opens']);

export const unavailableDownloadPreviewSchema = z.object({
   status: z.literal('unavailable'),
   store: storeKindSchema,
   version: z.string().nullable(),
   issue: downloadIssueSchema,
   detail: z.string().optional()
});

export const steamDownloadPreviewSchema = z.object({
   status: z.literal('ok'),
   store: z.literal('steam'),
   version: z.string(),
   name: z.string(),
   installRoot: z.string(),
   destinationPath: z.string(),
   warnings: z.array(downloadWarningSchema),
   manifestId: steamManifestIdSchema,
   steamPath: z.string(),
   depotPath: z.string()
});

export const oculusDownloadPreviewSchema = z.object({
   status: z.literal('ok'),
   store: z.literal('oculus'),
   version: z.string(),
   name: z.string(),
   installRoot: z.string(),
   destinationPath: z.string(),
   warnings: z.array(downloadWarningSchema),
   binaryId: z.string()
});

export const downloadRequestSchema = z.object({
   store: storeKindSchema.default('steam'),
   version: z.string().trim().min(1)
});

export const downloadStartResultSchema = z.union([
   z.object({
      ok: z.literal(true),
      value: operationSnapshotSchema
   }),
   z.object({
      ok: z.literal(false),
      error: operationErrorSchema
   })
]);

export type DownloadIssue = z.infer<typeof downloadIssueSchema>;
export type DownloadWarning = z.infer<typeof downloadWarningSchema>;
export type UnavailableDownloadPreview = z.infer<typeof unavailableDownloadPreviewSchema>;
export type SteamDownloadPreview = z.infer<typeof steamDownloadPreviewSchema>;
export type OculusDownloadPreview = z.infer<typeof oculusDownloadPreviewSchema>;
export type ReadyDownloadPreview = SteamDownloadPreview | OculusDownloadPreview;
export type DownloadRequestBody = z.infer<typeof downloadRequestSchema>;

export type DownloadOutcome = {
   installId: InstallId;
   store: StoreKind;
   name: string;
   path: string;
   version: string;
   bytes: number;
   files: number;
   protonRequested: boolean;
};

export type DownloadVersion = z.infer<typeof downloadVersionSchema>;
export type DownloadCatalogSnapshot = z.infer<typeof downloadCatalogSnapshotSchema>;
