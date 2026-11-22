import { z } from 'zod';

import type { IpcResult } from '@/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';
import { encoreProtocol } from '@/modules/shortcuts/contract';

const githubNamePattern = /^[a-z\d](?:[a-z\d._-]*[a-z\d])?$/i;

export type GitHubRepository = {
   owner: string;
   repo: string;
};

export function githubRepositoryFromUrl(value: string): GitHubRepository | null {
   if (!URL.canParse(value)) return null;

   const url = new URL(value);
   if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return null;

   const [owner, rawRepo] = url.pathname.split('/').filter(Boolean);
   const repo = rawRepo?.replace(/\.git$/i, '');

   if (!owner || !repo || !githubNamePattern.test(owner) || !githubNamePattern.test(repo)) return null;

   return { owner, repo };
}

export const modRepositoryPolicyUrl = 'https://encore.scoresaber.com/policy/mod-repositories.json';
export const modRepositoryPolicyHost = 'encore.scoresaber.com';
export const scoreSaberModSourceId = 'com.scoresaber.latest';
export const scoreSaberModSourceName = 'ScoreSaber';
export const scoreSaberModSourceUrl = 'https://encore.scoresaber.com/repos/scoresaber.json';
export const questModSourceId = 'bsquest';
export const questModSourceName = 'Quest mods';
export const questModRepoHost = 'mods.bsquest.xyz';
const questModSourceUrl = `https://${questModRepoHost}`;
export const modRepositoryListingSchemaVersion = 1;
export const modRepositoryPolicySchemaVersion = 1;
export const modRepositoryLinkAction = 'add-source';

export const modRepositoryLimits = {
   maxListingBytes: 4 * 1024 * 1024,
   maxPackages: 2_000,
   maxVersionsPerPackage: 50,
   maxFilesPerVersion: 64,
   maxPreviewPackages: 25
};

const modSourceKindSchema = z.enum(['official', 'unofficial']);
const modSourceStateSchema = z.enum(['ready', 'unavailable']);
const modRepositoryPolicyStateSchema = z.enum(['ready', 'stale', 'unavailable']);
export const modIdentityResolutionStrategySchema = z.enum(['highest-version', 'prefer-unofficial']);
export const modSourceResolutionSettingsSchema = z.object({
   combine: z.boolean(),
   strategy: modIdentityResolutionStrategySchema
});

export type ModSourceResolutionSettings = z.infer<typeof modSourceResolutionSettingsSchema>;

export const defaultModSourceResolutionSettings: ModSourceResolutionSettings = {
   combine: true,
   strategy: 'highest-version'
};

const modRepositoryIssueSchema = z.enum([
   'denylisted',
   'duplicate',
   'fetch-failed',
   'invalid-listing',
   'invalid-url',
   'not-acknowledged',
   'not-found',
   'policy-unavailable',
   'unsupported-schema',
   'write-failed'
]);

export const modRepositoryRecordSchema = z.object({
   id: z.string().trim().min(1).max(120),
   name: z.string().trim().min(1).max(120),
   owner: z.string().trim().max(120).default(''),
   listingUrl: z.string().trim().min(1).max(2048),
   infoUrl: z.string().trim().max(2048).nullable().default(null),
   contactUrl: z.string().trim().max(2048).nullable().default(null),
   enabled: z.boolean(),
   addedAt: z.string(),
   acknowledgedAt: z.string()
});

export type ModSourceKind = z.infer<typeof modSourceKindSchema>;
export type ModRepositoryPolicyState = z.infer<typeof modRepositoryPolicyStateSchema>;
export type ModRepositoryIssue = z.infer<typeof modRepositoryIssueSchema>;
export type ModRepositoryRecord = z.infer<typeof modRepositoryRecordSchema>;

const modSourceStatusSchema = z.object({
   id: z.string(),
   name: z.string(),
   kind: modSourceKindSchema,
   state: modSourceStateSchema,
   modCount: z.number(),
   issue: modRepositoryIssueSchema.optional(),
   detail: z.string().optional()
});

export type ModSourceStatus = z.infer<typeof modSourceStatusSchema>;

const modRepositorySummarySchema = z.object({
   id: z.string(),
   name: z.string(),
   owner: z.string(),
   listingUrl: z.string(),
   infoUrl: z.string().nullable(),
   contactUrl: z.string().nullable(),
   enabled: z.boolean(),
   addedAt: z.string(),
   blocked: z.boolean(),
   blockedReason: z.string().nullable(),
   blockedDetailsUrl: z.string().nullable(),
   packageCount: z.number().nullable(),
   checkedAt: z.string().nullable(),
   issue: modRepositoryIssueSchema.optional(),
   detail: z.string().optional()
});

const modOfficialSourceSummarySchema = z.object({
   id: z.string(),
   name: z.string(),
   listingUrl: z.string(),
   enabled: z.boolean()
});

const modRepositoriesSnapshotSchema = z.object({
   official: z.array(modOfficialSourceSummarySchema),
   repositories: z.array(modRepositorySummarySchema),
   resolution: modSourceResolutionSettingsSchema
});

export const modRepositorySyncRequestSchema = z.object({
   official: z.array(z.object({ id: z.string().min(1), enabled: z.boolean() })),
   repositories: z.array(z.object({ listingUrl: z.string().min(1), enabled: z.boolean() })),
   resolution: modSourceResolutionSettingsSchema
});

export const modRepositorySyncResultSchema = z.object({
   snapshot: modRepositoriesSnapshotSchema,
   failures: z.array(z.object({ listingUrl: z.string(), issue: modRepositoryIssueSchema, detail: z.string().optional() }))
});

export type ModRepositorySummary = z.infer<typeof modRepositorySummarySchema>;
export type ModOfficialSourceSummary = z.infer<typeof modOfficialSourceSummarySchema>;
export type ModRepositoriesSnapshot = z.infer<typeof modRepositoriesSnapshotSchema>;
export type ModRepositorySyncRequest = z.infer<typeof modRepositorySyncRequestSchema>;
export type ModRepositorySyncResult = z.infer<typeof modRepositorySyncResultSchema>;

type ModRepositoryPackagePreview = {
   id: string;
   name: string;
   version: string;
   downloadHost: string;
   identity: string | null;
};

type ReadyModRepositoryPreview = {
   status: 'ok';
   id: string;
   name: string;
   owner: string;
   listingUrl: string;
   infoUrl: string | null;
   contactUrl: string | null;
   packageCount: number;
   identityClaimCount: number;
   packages: ModRepositoryPackagePreview[];
   downloadHosts: string[];
};

export type ModRepositoryProblem = {
   status: 'invalid';
   issue: ModRepositoryIssue;
   detail?: string;
};

export type ModRepositoryPreview = ReadyModRepositoryPreview | ModRepositoryProblem;

export type ModRepositoryLinkEvent = { status: 'ready'; url: string } | { status: 'rejected'; issue: 'invalid-url' };

export type ModRepositoryResult = { status: 'ok'; snapshot: ModRepositoriesSnapshot } | ModRepositoryProblem;

export type ModRepositoryAddRequest = {
   url: string;
   acknowledged: boolean;
};

export type ModRepositoryToggleRequest = {
   id: string;
   enabled: boolean;
};

export type ModRepositoryIdRequest = {
   id: string;
};

export function modRepositoryProblem(issue: ModRepositoryIssue, detail?: string): ModRepositoryProblem {
   const problem: ModRepositoryProblem = { status: 'invalid', issue };
   if (detail) problem.detail = detail;
   return problem;
}

export function parseModRepositoryLink(value: string): ModRepositoryLinkEvent {
   if (!URL.canParse(value)) return { status: 'rejected', issue: 'invalid-url' };

   const link = new URL(value);
   const url = link.searchParams.get('url');
   if (link.protocol !== `${encoreProtocol}:` || link.host !== modRepositoryLinkAction || (link.pathname !== '' && link.pathname !== '/') || !url) {
      return { status: 'rejected', issue: 'invalid-url' };
   }

   return { status: 'ready', url };
}

export const beatModsOrigin = 'https://beatmods.com';
export const beatModsHost = 'beatmods.com';
export const officialModSourceId = 'beatmods';
export const officialModSourceName = 'BeatMods';

type OfficialModSource = {
   id: string;
   name: string;
   listingUrl: string;
   settingKey: 'officialModSourceEnabled' | 'scoreSaberModSourceEnabled' | 'questModSourceEnabled';
};

export const officialModSources: OfficialModSource[] = [
   { id: officialModSourceId, name: officialModSourceName, listingUrl: beatModsOrigin, settingKey: 'officialModSourceEnabled' },
   { id: questModSourceId, name: questModSourceName, listingUrl: questModSourceUrl, settingKey: 'questModSourceEnabled' },
   { id: scoreSaberModSourceId, name: scoreSaberModSourceName, listingUrl: scoreSaberModSourceUrl, settingKey: 'scoreSaberModSourceEnabled' }
];

export const bsipaModName = 'bsipa';

export const modPlatformSchema = z.enum(['steampc', 'oculuspc', 'universalpc', 'quest']);
const knownModCategorySchema = z.enum([
   'core',
   'essential',
   'leaderboards',
   'library',
   'cosmetic',
   'practice',
   'gameplay',
   'streamtools',
   'ui',
   'lighting',
   'tweaks',
   'multiplayer',
   'text',
   'editor',
   'other'
]);
export const knownModCategories = knownModCategorySchema.options;
const knownModCategoryByCompactName = new Map(knownModCategories.map((category) => [category.toLowerCase().replaceAll(/[^a-z0-9]/g, ''), category]));
export const modCategorySchema = z
   .string()
   .trim()
   .max(64)
   .transform((category) => {
      if (!category) return 'other';

      return knownModCategoryByCompactName.get(category.toLowerCase().replaceAll(/[^a-z0-9]/g, '')) ?? category;
   });

const modStateSchema = z.enum(['available', 'installed', 'update-available']);
const modCatalogSourceSchema = z.enum(['cache', 'remote']);

const modIssueSchema = z.enum([
   'catalog-unavailable',
   'inspect-failed',
   'not-found',
   'nothing-selected',
   'unknown-version',
   'unsupported-file',
   'unsupported-target'
]);

const modWarningSchema = z.enum([
   'bsipa-first',
   'claimed-identity',
   'missing-dependency',
   'patcher-runs',
   'patcher-unsupported',
   'removes-external',
   'replaces-installed',
   'unofficial-source',
   'unverified-source'
]);

export const modUninstallScopeSchema = z.enum(['all', 'selection']);

const modLinkKindSchema = z.enum(['listing', 'source', 'issues']);

const modLinkSchema = z.object({
   kind: modLinkKindSchema,
   url: z.string()
});

export type ModPlatform = z.infer<typeof modPlatformSchema>;
export type ModCategory = z.infer<typeof modCategorySchema>;
export type ModCatalogSource = z.infer<typeof modCatalogSourceSchema>;
export type ModIssue = z.infer<typeof modIssueSchema>;
export type ModWarning = z.infer<typeof modWarningSchema>;
export type ModUninstallScope = z.infer<typeof modUninstallScopeSchema>;
export type ModLinkKind = z.infer<typeof modLinkKindSchema>;
export type ModLink = z.infer<typeof modLinkSchema>;

const modSummarySchema = z.object({
   modId: z.string(),
   sourceId: z.string(),
   sourceName: z.string(),
   sourceKind: modSourceKindSchema,
   name: z.string(),
   summary: z.string(),
   description: z.string(),
   iconUrl: z.string().nullable(),
   links: z.array(modLinkSchema),
   category: modCategorySchema,
   author: z.string(),
   state: modStateSchema,
   latestVersion: z.string(),
   installedVersion: z.string().nullable(),
   sizeBytes: z.number().nullable(),
   isBsipa: z.boolean(),
   isRequired: z.boolean(),
   dependencyIds: z.array(z.string()),
   claimedIdentity: z.string().nullable()
});

const externalModDetailsSchema = z.object({
   name: z.string(),
   version: z.string().nullable(),
   author: z.string().nullable(),
   gameVersion: z.string().nullable(),
   description: z.string().nullable(),
   links: z.array(modLinkSchema)
});

const externalModSchema = z.object({
   id: z.string(),
   name: z.string(),
   path: z.string(),
   sizeBytes: z.number(),
   details: externalModDetailsSchema.nullable()
});

const unavailableModsSnapshotSchema = z.object({
   status: z.literal('unavailable'),
   installId: z.string(),
   issue: modIssueSchema,
   detail: z.string().optional()
});

export const readyModsSnapshotSchema = z.object({
   status: z.literal('ready'),
   installId: z.string(),
   installPath: z.string(),
   gameVersion: z.string(),
   platform: modPlatformSchema,
   source: modCatalogSourceSchema,
   updatedAt: z.string(),
   sources: z.array(modSourceStatusSchema),
   mods: z.array(modSummarySchema),
   external: z.array(externalModSchema),
   bsipaInstalled: z.boolean()
});

export const modsSnapshotSchema = z.discriminatedUnion('status', [unavailableModsSnapshotSchema, readyModsSnapshotSchema]);

const modActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   issue: modIssueSchema,
   detail: z.string().optional()
});

const modPlanEntrySchema = z.object({
   modId: z.string(),
   sourceName: z.string(),
   sourceKind: modSourceKindSchema,
   name: z.string(),
   version: z.string(),
   sizeBytes: z.number().nullable(),
   reason: z.enum(['dependency', 'selected', 'update']),
   isBsipa: z.boolean()
});

const readyModInstallPreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   installPath: z.string(),
   pendingPath: z.string(),
   downloadHosts: z.array(z.string()),
   mods: z.array(modPlanEntrySchema),
   downloadBytes: z.number().nullable(),
   warnings: z.array(modWarningSchema)
});

export const modInstallPreviewSchema = z.discriminatedUnion('status', [modActionProblemSchema, readyModInstallPreviewSchema]);

const modRemovalSchema = z.object({
   modId: z.string(),
   name: z.string(),
   version: z.string(),
   files: z.array(z.string())
});

const readyModUninstallPreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   installPath: z.string(),
   scope: modUninstallScopeSchema,
   mods: z.array(modRemovalSchema),
   external: z.array(externalModSchema),
   folders: z.array(z.string()),
   fileCount: z.number(),
   warnings: z.array(modWarningSchema)
});

export const modUninstallPreviewSchema = z.discriminatedUnion('status', [modActionProblemSchema, readyModUninstallPreviewSchema]);

const readyModChangesPreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   install: readyModInstallPreviewSchema,
   uninstall: readyModUninstallPreviewSchema,
   warnings: z.array(modWarningSchema)
});

export const modChangesPreviewSchema = z.discriminatedUnion('status', [modActionProblemSchema, readyModChangesPreviewSchema]);

const readyModImportPreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   sourcePath: z.string(),
   uploadId: z.string().optional(),
   kind: z.enum(['dll', 'zip', 'qmod']),
   name: z.string(),
   sizeBytes: z.number(),
   destinationPath: z.string(),
   warnings: z.array(modWarningSchema)
});

export const modImportPreviewSchema = z.discriminatedUnion('status', [modActionProblemSchema, readyModImportPreviewSchema]);

export const modImportUploadRequestSchema = z.object({
   installId: z.string().min(1),
   fileName: z.string().min(1).max(255),
   sizeBytes: z.number().int().positive(),
   sha256: z.string().regex(/^[a-f\d]{64}$/i)
});

export const modImportUploadPreparedSchema = z.discriminatedUnion('status', [
   modActionProblemSchema,
   z.object({ status: z.literal('ready'), installId: z.string(), uploadId: z.string() })
]);

export const modImportUploadIdSchema = z.object({ installId: z.string().min(1), uploadId: z.string().min(1) });

export type ModSummary = z.infer<typeof modSummarySchema>;
export type ExternalMod = z.infer<typeof externalModSchema>;
export type ExternalModDetails = z.infer<typeof externalModDetailsSchema>;
type UnavailableModsSnapshot = z.infer<typeof unavailableModsSnapshotSchema>;
export type ReadyModsSnapshot = z.infer<typeof readyModsSnapshotSchema>;
export type ModsSnapshot = z.infer<typeof modsSnapshotSchema>;
export type ModActionProblem = z.infer<typeof modActionProblemSchema>;
export type ModPlanEntry = z.infer<typeof modPlanEntrySchema>;
export type ReadyModInstallPreview = z.infer<typeof readyModInstallPreviewSchema>;
export type ModInstallPreview = z.infer<typeof modInstallPreviewSchema>;
export type ModRemoval = z.infer<typeof modRemovalSchema>;
export type ReadyModUninstallPreview = z.infer<typeof readyModUninstallPreviewSchema>;
export type ModUninstallPreview = z.infer<typeof modUninstallPreviewSchema>;
export type ReadyModChangesPreview = z.infer<typeof readyModChangesPreviewSchema>;
export type ModChangesPreview = z.infer<typeof modChangesPreviewSchema>;
export type ReadyModImportPreview = z.infer<typeof readyModImportPreviewSchema>;
export type ModImportPreview = z.infer<typeof modImportPreviewSchema>;
export type ModImportUploadRequest = z.infer<typeof modImportUploadRequestSchema>;
export type ModImportUploadPrepared = z.infer<typeof modImportUploadPreparedSchema>;

export type ModOperationResult = IpcResult<OperationSnapshot>;

export type ModRequest = {
   installId: InstallId;
};

export type ModSelectionRequest = ModRequest & {
   modIds: string[];
};

export type ModUninstallRequest = ModRequest & {
   scope: ModUninstallScope;
   modIds: string[];
   externalIds: string[];
};

export type ModChangesRequest = ModRequest & {
   installModIds: string[];
   removeModIds: string[];
};

export type ModImportRequest = ModRequest & {
   sourcePath: string;
   sourceName?: string;
   uploadId?: string;
};

export type ModLinkRequest = {
   url: string;
};

export type ModFundingResult = { status: 'available'; url: string } | { status: 'unavailable' };

export type ModImportChoice = { status: 'cancelled' } | { status: 'unsupported' } | { status: 'selected'; preview: ModImportPreview };

export function invalidModAction(request: ModRequest, issue: ModIssue, detail?: string): ModActionProblem {
   const problem: ModActionProblem = { status: 'invalid', installId: request.installId, issue };
   if (detail) problem.detail = detail;
   return problem;
}

export function unavailableModsSnapshot(request: ModRequest, issue: ModIssue, detail?: string): UnavailableModsSnapshot {
   const snapshot: UnavailableModsSnapshot = { status: 'unavailable', installId: request.installId, issue };
   if (detail) snapshot.detail = detail;
   return snapshot;
}
