import { z } from 'zod';

import type { IpcResult } from '@/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import type { OperationSnapshot } from '@/modules/operations/contract';

export const builtInSharedFolderIdSchema = z.enum(['avatars', 'maps', 'notes', 'platforms', 'playlists', 'sabers', 'user-data', 'wip-maps']);
export const customSharedFolderIdSchema = z.string().regex(/^custom-[0-9a-f]{24}$/);
export const sharedFolderIdSchema = z.union([builtInSharedFolderIdSchema, customSharedFolderIdSchema]);
export const sharedFolderKindSchema = z.enum(['custom', 'maps', 'models', 'playlists']);

export const relativeFolderPathSchema = z
   .string()
   .trim()
   .min(1)
   .transform((path) => path.replaceAll('\\', '/'))
   .refine(
      (path) =>
         !path.startsWith('/') &&
         !/^[a-z]:/i.test(path) &&
         !path.includes(String.fromCodePoint(0)) &&
         path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
      'folder path must stay inside its install or library'
   );

export const customSharedFolderSchema = z.object({
   id: customSharedFolderIdSchema,
   installRelativePath: relativeFolderPathSchema,
   libraryRelativePath: relativeFolderPathSchema
});

export const sharedFolderLinkStateSchema = z.enum(['absent', 'blocked', 'broken', 'foreign', 'linked', 'unlinked']);
export const sharedLinkModeSchema = z.enum(['junction', 'symlink']);
export const sharedContentStatusSchema = z.enum(['missing', 'ready', 'unsupported']);
export const sharedContentActionSchema = z.enum(['link', 'repair', 'unlink']);

export const sharedContentsModeSchema = z.enum(['copy', 'discard', 'keep', 'move']);

export const sharedContentWarningSchema = z.enum([
   'creates-shared-folder',
   'discards-contents',
   'merges-into-shared',
   'move-blocked',
   'name-conflicts',
   'risky-folder',
   'shared-kept',
   'still-linked'
]);

export const sharedContentIssueSchema = z.enum([
   'already-linked',
   'inspect-failed',
   'install-not-found',
   'link-unsupported',
   'not-linked',
   'nothing-to-connect',
   'path-blocked',
   'shared-root-unavailable',
   'unknown-folder',
   'unknown-root',
   'unsupported-target'
]);

export const sharedContentProblemCodeSchema = z.enum([
   'shared.folder.unreadable',
   'shared.link.failed',
   'shared.root.unreadable',
   'shared.support.failed'
]);

export const sharedContentProblemSchema = z.object({
   code: sharedContentProblemCodeSchema,
   message: z.string(),
   folderId: sharedFolderIdSchema.optional(),
   path: z.string().optional(),
   detail: z.string().optional()
});

export type SharedFolderId = z.infer<typeof sharedFolderIdSchema>;
export type BuiltInSharedFolderId = z.infer<typeof builtInSharedFolderIdSchema>;
export type SharedFolderKind = z.infer<typeof sharedFolderKindSchema>;
export type SharedFolderLinkState = z.infer<typeof sharedFolderLinkStateSchema>;
export type SharedLinkMode = z.infer<typeof sharedLinkModeSchema>;
export type SharedContentStatus = z.infer<typeof sharedContentStatusSchema>;
export type SharedContentAction = z.infer<typeof sharedContentActionSchema>;
export type SharedContentsMode = z.infer<typeof sharedContentsModeSchema>;
export type SharedContentWarning = z.infer<typeof sharedContentWarningSchema>;
export type SharedContentIssue = z.infer<typeof sharedContentIssueSchema>;
export type SharedContentProblem = z.infer<typeof sharedContentProblemSchema>;
export type CustomSharedFolder = z.infer<typeof customSharedFolderSchema>;

export type SharedFolderDefinition = {
   id: SharedFolderId;
   kind: SharedFolderKind;
   segments: string[];
   sharedSegments: string[];
   risky: boolean;
};

export const sharedFolderDefinitions: SharedFolderDefinition[] = [
   // this allowlist prevents links outside known Beat Saber content folders
   { id: 'maps', kind: 'maps', segments: ['Beat Saber_Data', 'CustomLevels'], sharedSegments: ['SharedMaps', 'CustomLevels'], risky: false },
   { id: 'wip-maps', kind: 'maps', segments: ['Beat Saber_Data', 'CustomWIPLevels'], sharedSegments: ['CustomWIPLevels'], risky: false },
   { id: 'playlists', kind: 'playlists', segments: ['Playlists'], sharedSegments: ['Playlists'], risky: false },
   { id: 'avatars', kind: 'models', segments: ['CustomAvatars'], sharedSegments: ['CustomAvatars'], risky: false },
   { id: 'sabers', kind: 'models', segments: ['CustomSabers'], sharedSegments: ['CustomSabers'], risky: false },
   { id: 'platforms', kind: 'models', segments: ['CustomPlatforms'], sharedSegments: ['CustomPlatforms'], risky: false },
   { id: 'notes', kind: 'models', segments: ['CustomNotes'], sharedSegments: ['CustomNotes'], risky: false },
   { id: 'user-data', kind: 'custom', segments: ['UserData'], sharedSegments: ['UserData'], risky: true }
];

export const sharedLinkSupportSchema = z.object({
   supported: z.boolean(),
   mode: sharedLinkModeSchema,
   requestedMode: sharedLinkModeSchema,
   detail: z.string().nullable()
});

export const sharedFolderStatusSchema = z.object({
   id: sharedFolderIdSchema,
   kind: sharedFolderKindSchema,
   relativePath: z.string(),
   installFolderPath: z.string(),
   sharedFolderPath: z.string(),
   state: sharedFolderLinkStateSchema,
   linkTargetPath: z.string().nullable(),
   // the known root the link points into, null unless state is linked
   rootPath: z.string().nullable().default(null),
   risky: z.boolean()
});

export const sharedContentSnapshotSchema = z.object({
   installId: z.string(),
   status: sharedContentStatusSchema,
   installPath: z.string().nullable(),
   sharedRootPath: z.string().nullable(),
   linkSupport: sharedLinkSupportSchema.nullable(),
   folders: z.array(sharedFolderStatusSchema),
   problems: z.array(sharedContentProblemSchema),
   scannedAt: z.string().nullable()
});

export const sharedFolderInstallLinkSchema = z.object({
   installId: z.string(),
   installName: z.string(),
   state: sharedFolderLinkStateSchema
});

export const sharedRootFolderSchema = z.object({
   id: sharedFolderIdSchema,
   relativePath: z.string(),
   path: z.string(),
   exists: z.boolean()
});

export const sharedRootOverviewSchema = z.object({
   path: z.string(),
   active: z.boolean(),
   exists: z.boolean(),
   folders: z.array(sharedRootFolderSchema)
});

export const sharedInstallOverviewSchema = z.object({
   installId: z.string(),
   installName: z.string(),
   installPath: z.string(),
   folders: z.array(sharedFolderStatusSchema)
});

export const sharedFolderOverviewSchema = z.object({
   id: sharedFolderIdSchema,
   kind: sharedFolderKindSchema,
   relativePath: z.string(),
   sharedFolderPath: z.string(),
   exists: z.boolean(),
   installs: z.array(sharedFolderInstallLinkSchema)
});

export const sharedContentOverviewSchema = z.object({
   status: sharedContentStatusSchema,
   installRoot: z.string().nullable(),
   sharedRootPath: z.string().nullable(),
   linkSupport: sharedLinkSupportSchema.nullable(),
   folders: z.array(sharedFolderOverviewSchema),
   roots: z.array(sharedRootOverviewSchema),
   installs: z.array(sharedInstallOverviewSchema),
   problems: z.array(sharedContentProblemSchema),
   scannedAt: z.string().nullable()
});

export type SharedLinkSupport = z.infer<typeof sharedLinkSupportSchema>;
export type SharedFolderStatus = z.infer<typeof sharedFolderStatusSchema>;
export type SharedContentSnapshot = z.infer<typeof sharedContentSnapshotSchema>;
export type SharedFolderInstallLink = z.infer<typeof sharedFolderInstallLinkSchema>;
export type SharedFolderOverview = z.infer<typeof sharedFolderOverviewSchema>;
export type SharedRootOverview = z.infer<typeof sharedRootOverviewSchema>;
export type SharedInstallOverview = z.infer<typeof sharedInstallOverviewSchema>;
export type SharedContentOverview = z.infer<typeof sharedContentOverviewSchema>;

export type SharedContentRequest = {
   installId: InstallId;
};

export type SharedFolderRequest = SharedContentRequest & {
   folderId: SharedFolderId;
};

export type SharedContentActionRequest = SharedFolderRequest & {
   action: SharedContentAction;
   contents?: SharedContentsMode;
};

export type SharedContentOpenFolderResult = { status: 'opened' } | { status: 'unsupported' } | { status: 'failed'; message: string };

export const sharedContentActionProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   folderId: sharedFolderIdSchema,
   action: sharedContentActionSchema,
   issue: sharedContentIssueSchema,
   detail: z.string().optional()
});

export const readySharedContentPreviewSchema = z.object({
   status: z.literal('ok'),
   action: sharedContentActionSchema,
   installId: z.string(),
   folderId: sharedFolderIdSchema,
   relativePath: z.string(),
   installFolderPath: z.string(),
   sharedFolderPath: z.string(),
   state: sharedFolderLinkStateSchema,
   linkMode: sharedLinkModeSchema,
   contents: sharedContentsModeSchema,
   installBytes: z.number(),
   installFiles: z.number(),
   sharedBytes: z.number(),
   sharedFiles: z.number(),
   conflictCount: z.number(),
   conflictPath: z.string().nullable(),
   backupPath: z.string().nullable(),
   linkedInstalls: z.array(z.string()),
   warnings: z.array(sharedContentWarningSchema)
});

export const sharedContentPreviewSchema = z.discriminatedUnion('status', [readySharedContentPreviewSchema, sharedContentActionProblemSchema]);

export type SharedContentActionProblem = z.infer<typeof sharedContentActionProblemSchema>;
export type ReadySharedContentPreview = z.infer<typeof readySharedContentPreviewSchema>;
export type SharedContentPreview = z.infer<typeof sharedContentPreviewSchema>;

export type SharedContentOperationResult = IpcResult<OperationSnapshot>;

export type SharedContentOutcome = {
   installId: InstallId;
   folderId: SharedFolderId;
   action: SharedContentAction;
   bytes: number;
   files: number;
   conflicts: number;
   backupPath: string | null;
};

// bulk connect/disconnect: point every applicable folder of an install at one root

export const sharedConnectActionSchema = z.enum(['connect', 'disconnect']);
export const sharedConnectStepSchema = z.enum(['link', 'repair', 'skip', 'unlink']);

export type SharedConnectAction = z.infer<typeof sharedConnectActionSchema>;
export type SharedConnectStep = z.infer<typeof sharedConnectStepSchema>;

export type SharedConnectRequest = {
   installId: InstallId;
   action: SharedConnectAction;
   rootPath?: string;
   contents?: SharedContentsMode;
   includeRisky?: boolean;
};

export const sharedConnectFolderPlanSchema = z.object({
   id: sharedFolderIdSchema,
   relativePath: z.string(),
   state: sharedFolderLinkStateSchema,
   rootPath: z.string().nullable(),
   step: sharedConnectStepSchema,
   bytes: z.number(),
   files: z.number(),
   conflictCount: z.number(),
   risky: z.boolean()
});

export const readySharedConnectPreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   action: sharedConnectActionSchema,
   rootPath: z.string(),
   linkMode: sharedLinkModeSchema,
   contents: sharedContentsModeSchema,
   includeRisky: z.boolean(),
   folders: z.array(sharedConnectFolderPlanSchema),
   warnings: z.array(sharedContentWarningSchema)
});

export const sharedConnectProblemSchema = z.object({
   status: z.literal('invalid'),
   installId: z.string(),
   action: sharedConnectActionSchema,
   issue: sharedContentIssueSchema,
   detail: z.string().optional()
});

export const sharedConnectPreviewSchema = z.discriminatedUnion('status', [readySharedConnectPreviewSchema, sharedConnectProblemSchema]);

export type SharedConnectFolderPlan = z.infer<typeof sharedConnectFolderPlanSchema>;
export type ReadySharedConnectPreview = z.infer<typeof readySharedConnectPreviewSchema>;
export type SharedConnectProblem = z.infer<typeof sharedConnectProblemSchema>;
export type SharedConnectPreview = z.infer<typeof sharedConnectPreviewSchema>;

export type SharedConnectOutcome = {
   installId: InstallId;
   action: SharedConnectAction;
   rootPath: string;
   folders: number;
   bytes: number;
   files: number;
   conflicts: number;
};

// shared root management

export const sharedRootIssueSchema = z.enum([
   'create-failed',
   'remote-failed',
   'root-active',
   'root-inside-install',
   'root-unknown',
   'unsupported-target'
]);

export type SharedRootIssue = z.infer<typeof sharedRootIssueSchema>;

export type SharedRootRequest = {
   path: string;
};

export const sharedRootActionResultSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('ok') }),
   z.object({ status: z.literal('invalid'), issue: sharedRootIssueSchema, detail: z.string().optional() })
]);

export const sharedRootCandidateSchema = z.object({
   path: z.string(),
   exists: z.boolean(),
   alreadyKnown: z.boolean(),
   foldersFound: z.array(
      z.object({
         id: sharedFolderIdSchema,
         relativePath: z.string()
      })
   )
});

export type SharedRootActionResult = z.infer<typeof sharedRootActionResultSchema>;
export type SharedRootCandidate = z.infer<typeof sharedRootCandidateSchema>;

export type SharedRootChoice = { status: 'cancelled' } | ({ status: 'selected' } & SharedRootCandidate);

export const customSharedFolderIssueSchema = z.enum([
   'already-added',
   'choose-failed',
   'destination-conflict',
   'folder-linked',
   'install-not-found',
   'outside-install',
   'overlapping-folder',
   'unknown-folder',
   'unsupported-target',
   'unsafe-folder',
   'write-failed'
]);

export const customSharedFolderActionResultSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('ok'), folder: customSharedFolderSchema }),
   z.object({ status: z.literal('invalid'), issue: customSharedFolderIssueSchema, detail: z.string().optional() })
]);

export type CustomSharedFolderIssue = z.infer<typeof customSharedFolderIssueSchema>;
export type CustomSharedFolderActionResult = z.infer<typeof customSharedFolderActionResultSchema>;
export type AddCustomSharedFolderRequest = {
   installId: InstallId;
   relativePath: string;
};
export type ForgetCustomSharedFolderRequest = {
   folderId: SharedFolderId;
};
export type CustomSharedFolderChoice =
   | { status: 'cancelled' }
   | { status: 'unsupported' }
   | { status: 'selected'; relativePath: string }
   | { status: 'invalid'; issue: CustomSharedFolderIssue; detail?: string };

export function isBuiltInSharedFolderId(folderId: SharedFolderId): folderId is BuiltInSharedFolderId {
   return !folderId.startsWith('custom-');
}

export function isCustomSharedFolderId(folderId: SharedFolderId) {
   return !isBuiltInSharedFolderId(folderId);
}

export function sharedFolderRelativePath(definition: SharedFolderDefinition) {
   return definition.segments.join('/');
}

export function sharedFolderLibraryRelativePath(definition: SharedFolderDefinition) {
   return definition.sharedSegments.join('/');
}

export function createCustomSharedFolderDefinition(folder: CustomSharedFolder): SharedFolderDefinition {
   return {
      id: folder.id,
      kind: 'custom',
      segments: folder.installRelativePath.split('/'),
      sharedSegments: folder.libraryRelativePath.split('/'),
      risky: true
   };
}

export function configuredSharedFolderDefinitions(customFolders: CustomSharedFolder[]) {
   const customDefinitions = customFolders.map(createCustomSharedFolderDefinition);
   const builtIns = sharedFolderDefinitions.filter(
      (definition) =>
         !customDefinitions.some((custom) => isStrictRelativePathInside(sharedFolderRelativePath(definition), sharedFolderRelativePath(custom)))
   );

   return [...builtIns, ...customDefinitions];
}

export function relativeFolderPathsOverlap(first: string, second: string) {
   const firstKey = relativeFolderPathKey(first);
   const secondKey = relativeFolderPathKey(second);

   return firstKey === secondKey || firstKey.startsWith(`${secondKey}/`) || secondKey.startsWith(`${firstKey}/`);
}

function isStrictRelativePathInside(parent: string, child: string) {
   const parentKey = relativeFolderPathKey(parent);
   const childKey = relativeFolderPathKey(child);

   return childKey.startsWith(`${parentKey}/`);
}

function relativeFolderPathKey(path: string) {
   return path.replaceAll('\\', '/').toLowerCase();
}

export function defaultContentsMode(action: SharedContentAction): SharedContentsMode {
   if (action === 'link') return 'move';

   return action === 'unlink' ? 'copy' : 'keep';
}

export function isContentsModeAllowed(action: SharedContentAction, contents: SharedContentsMode) {
   if (action === 'link') return contents === 'discard' || contents === 'move';
   if (action === 'unlink') return contents === 'copy' || contents === 'keep' || contents === 'move';

   return contents === 'keep';
}

export function defaultConnectContents(action: SharedConnectAction): SharedContentsMode {
   return action === 'connect' ? 'move' : 'copy';
}

export function isConnectContentsAllowed(action: SharedConnectAction, contents: SharedContentsMode) {
   if (action === 'connect') return contents === 'discard' || contents === 'move';

   return contents === 'copy' || contents === 'keep';
}

export function invalidSharedConnect(request: SharedConnectRequest, issue: SharedContentIssue, detail?: string): SharedConnectProblem {
   const problem: SharedConnectProblem = { status: 'invalid', installId: request.installId, action: request.action, issue };
   if (detail) problem.detail = detail;
   return problem;
}

export function invalidSharedContentAction(
   request: SharedFolderRequest & { action: SharedContentAction },
   issue: SharedContentIssue,
   detail?: string
): SharedContentActionProblem {
   const problem: SharedContentActionProblem = {
      status: 'invalid',
      installId: request.installId,
      folderId: request.folderId,
      action: request.action,
      issue
   };
   if (detail) problem.detail = detail;
   return problem;
}

export function createEmptySharedContentSnapshot(request: SharedContentRequest, status: SharedContentStatus = 'missing'): SharedContentSnapshot {
   return {
      installId: request.installId,
      status,
      installPath: null,
      sharedRootPath: null,
      linkSupport: null,
      folders: [],
      problems: [],
      scannedAt: null
   };
}

export function createEmptySharedContentOverview(status: SharedContentStatus = 'missing'): SharedContentOverview {
   return {
      status,
      installRoot: null,
      sharedRootPath: null,
      linkSupport: null,
      folders: [],
      roots: [],
      installs: [],
      problems: [],
      scannedAt: null
   };
}
