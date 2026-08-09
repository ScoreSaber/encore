import { Result } from 'better-result';

import { readRecent, setRecent } from '@/lib/content/content-cache';
import { createContentFailure, createOperationFailure } from '@/lib/content/content-errors';
import { createContentEvents } from '@/lib/content/content-events';
import { isPathInside, isSamePath, resolveFilesystemPath, pathExistsSafely } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import type { InstallId, InstallSummary } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { LibrarySettingsPatch } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import {
   createEmptySharedContentOverview,
   createEmptySharedContentSnapshot,
   defaultConnectContents,
   defaultContentsMode,
   findSharedFolderDefinition,
   invalidSharedConnect,
   invalidSharedContentAction,
   isConnectContentsAllowed,
   isContentsModeAllowed,
   sharedFolderDefinitions,
   sharedFolderRelativePath,
   type ReadySharedConnectPreview,
   type ReadySharedContentPreview,
   type SharedConnectFolderPlan,
   type SharedConnectOutcome,
   type SharedConnectPreview,
   type SharedConnectRequest,
   type SharedConnectStep,
   type SharedContentAction,
   type SharedContentActionRequest,
   type SharedContentIssue,
   type SharedContentOperationResult,
   type SharedContentOutcome,
   type SharedContentOverview,
   type SharedContentPreview,
   type SharedContentProblem,
   type SharedContentRequest,
   type SharedContentSnapshot,
   type SharedContentsMode,
   type SharedContentWarning,
   type SharedFolderDefinition,
   type SharedFolderId,
   type SharedFolderInstallLink,
   type SharedFolderOverview,
   type SharedFolderRequest,
   type SharedFolderStatus,
   type SharedInstallOverview,
   type SharedLinkSupport,
   type SharedRootActionResult,
   type SharedRootRequest,
   type SharedRootOverview
} from '@/modules/shared-content/contract';
import { preferredLinkMode, probeLinkSupport, readFolderLink } from '@/modules/shared-content/main/folder-link';
import { createSharedContentTransfers, type FolderContext } from '@/modules/shared-content/main/shared-content-transfer';
import {
   backupFolderPath,
   conflictFolderPath,
   defaultSharedContentRootPath,
   installFolderPath,
   sharedFolderPath
} from '@/modules/shared-content/main/shared-paths';

import { mkdir, readdir } from 'node:fs/promises';

const actionIssueMessages: Record<SharedContentIssue, string> = {
   'already-linked': 'this folder is already a link',
   'inspect-failed': 'the folder could not be inspected',
   'install-not-found': 'the install is not in the registry anymore',
   'link-unsupported': 'this filesystem cannot create the links Encore uses',
   'not-linked': 'this folder is not shared right now',
   'nothing-to-connect': 'every folder is already where it should be',
   'path-blocked': 'something that is not a folder sits in that place',
   'shared-root-unavailable': 'the shared content folder could not be created',
   'unknown-folder': 'that folder cannot be shared',
   'unknown-root': 'that folder is not a known shared content root',
   'unsupported-target': 'this target cannot share content'
};

type SharedContentServiceOptions = {
   registry: InstallRegistry;
   settingsStore: SettingsStore;
   operations: OperationRegistry;
   platform?: NodeJS.Platform;
};

type ResolvedFolder = { status: 'invalid'; issue: SharedContentIssue; detail?: string } | ({ status: 'ok' } & FolderContext);

type Library = {
   installRoot: string;
   sharedRootPath: string;
   rootPaths: string[];
   useSymlinks: boolean;
};

export type SharedContentService = ReturnType<typeof createSharedContentService>;

export function createSharedContentService(options: SharedContentServiceOptions) {
   const platform = options.platform ?? process.platform;
   const snapshots = new Map<InstallId, SharedContentSnapshot>();
   const maxCachedSnapshots = 12;
   const events = createContentEvents<SharedContentSnapshot>();
   const failure = createContentFailure<SharedContentIssue>('shared-content', actionIssueMessages);
   const failOperation = createOperationFailure(options.operations);
   const transfers = createSharedContentTransfers(options.operations);
   let cachedSupport: SharedLinkSupport | null = null;
   let cachedSupportRoot: string | null = null;

   async function list(input: SharedContentRequest) {
      const { installId } = input;
      return readRecent(snapshots, installId) ?? scan(installId);
   }

   async function rescan(input: SharedContentRequest) {
      const { installId } = input;
      return scan(installId, true);
   }

   async function scan(installId: InstallId, force = false): Promise<SharedContentSnapshot> {
      const install = await options.registry.get(installId);
      if (!install) return publish(createEmptySharedContentSnapshot({ installId }, 'missing'));

      const library = await readLibrary();
      const sharedRootPath = library.sharedRootPath;
      const support = await readLinkSupport(sharedRootPath, library.useSymlinks, force);
      const problems: SharedContentProblem[] = [];
      const folders: SharedFolderStatus[] = [];

      for (const definition of sharedFolderDefinitions) {
         folders.push(await readFolderStatus(install.path, sharedRootPath, definition, library.rootPaths));
      }

      if (!support.supported) {
         problems.push({
            code: 'shared.support.failed',
            message: 'this filesystem cannot create the links Encore uses',
            path: sharedRootPath,
            ...(support.detail ? { detail: support.detail } : {})
         });
      }

      return publish({
         installId,
         status: 'ready',
         installPath: install.path,
         sharedRootPath,
         linkSupport: support,
         folders,
         problems,
         scannedAt: new Date().toISOString()
      });
   }

   async function getOverview(): Promise<SharedContentOverview> {
      const registrySnapshot = await options.registry.list();
      const library = await readLibrary();
      const sharedRootPath = library.sharedRootPath;
      const support = await readLinkSupport(sharedRootPath, library.useSymlinks);

      const installs: SharedInstallOverview[] = [];
      for (const install of registrySnapshot.installs) {
         const statuses: SharedFolderStatus[] = [];
         for (const definition of sharedFolderDefinitions) {
            statuses.push(await readFolderStatus(install.path, sharedRootPath, definition, library.rootPaths));
         }

         installs.push({ installId: install.id, installName: install.name, installPath: install.path, folders: statuses });
      }

      const roots: SharedRootOverview[] = [];
      for (const rootPath of library.rootPaths) {
         const folders = [];
         for (const definition of sharedFolderDefinitions) {
            const folderPath = sharedFolderPath(rootPath, definition);
            folders.push({ id: definition.id, path: folderPath, exists: await pathExistsSafely(folderPath) });
         }

         roots.push({
            path: rootPath,
            active: isSamePath(rootPath, sharedRootPath),
            exists: await pathExistsSafely(rootPath),
            folders
         });
      }

      // the folder-centric view stays scoped to the active root
      const folders: SharedFolderOverview[] = sharedFolderDefinitions.map((definition) => {
         const folderPath = sharedFolderPath(sharedRootPath, definition);
         const links: SharedFolderInstallLink[] = [];

         for (const install of installs) {
            const status = install.folders.find((folder) => folder.id === definition.id);
            if (!status) continue;

            const linkedHere = status.state === 'linked' && status.rootPath !== null && isSamePath(status.rootPath, sharedRootPath);
            if (!linkedHere && status.state !== 'broken' && status.state !== 'foreign') continue;

            links.push({ installId: install.installId, installName: install.installName, state: status.state });
         }

         return {
            id: definition.id,
            kind: definition.kind,
            relativePath: sharedFolderRelativePath(definition),
            sharedFolderPath: folderPath,
            exists: roots.find((root) => root.active)?.folders.find((folder) => folder.id === definition.id)?.exists ?? false,
            installs: links
         };
      });

      return {
         ...createEmptySharedContentOverview('ready'),
         installRoot: library.installRoot,
         sharedRootPath,
         linkSupport: support,
         folders,
         roots,
         installs,
         scannedAt: new Date().toISOString()
      };
   }

   async function getFolderPath(request: SharedFolderRequest) {
      const definition = findSharedFolderDefinition(request.folderId);
      if (!definition) return null;

      const library = await readLibrary();

      return sharedFolderPath(library.sharedRootPath, definition);
   }

   async function preview(request: SharedContentActionRequest, rootPath?: string): Promise<SharedContentPreview> {
      const resolved = await resolveFolder(request, rootPath);
      if (resolved.status === 'invalid') return invalidSharedContentAction(request, resolved.issue, resolved.detail);

      const issue = actionIssue(request.action, resolved);
      if (issue) return invalidSharedContentAction(request, issue);

      const contents = readContentsMode(request);
      const warnings: SharedContentWarning[] = [];
      const installSize = resolved.state === 'unlinked' ? await readSize(resolved.folderPath) : null;
      const sharedSize = await readSize(resolved.sharedFolderPath);
      const linkedInstalls = await findLinkedInstalls(resolved);
      const conflicts =
         request.action === 'link' && contents === 'move' ? await countConflicts(resolved.state, resolved.folderPath, resolved.sharedFolderPath) : 0;
      const backupPath =
         request.action === 'link' && resolved.definition.risky && resolved.state === 'unlinked' ? backupFolderPath(resolved.folderPath) : null;

      if (resolved.definition.risky) warnings.push('risky-folder');

      if (request.action === 'link') {
         if (!sharedSize) warnings.push('creates-shared-folder');
         if (contents === 'discard' && installSize && installSize.files > 0) warnings.push('discards-contents');
         if (contents === 'move' && sharedSize && installSize && installSize.files > 0) warnings.push('merges-into-shared');
         if (conflicts > 0) warnings.push('name-conflicts');
      }

      if (request.action === 'unlink') {
         warnings.push('shared-kept');
         if (linkedInstalls.length > 0) warnings.push('still-linked');
         if (contents === 'move' && linkedInstalls.length > 0) warnings.push('move-blocked');
      }

      return {
         status: 'ok',
         action: request.action,
         installId: request.installId,
         folderId: resolved.definition.id,
         relativePath: sharedFolderRelativePath(resolved.definition),
         installFolderPath: resolved.folderPath,
         sharedFolderPath: resolved.sharedFolderPath,
         state: resolved.state,
         linkMode: resolved.support.mode,
         contents: contents === 'move' && warnings.includes('move-blocked') ? 'copy' : contents,
         installBytes: installSize?.bytes ?? 0,
         installFiles: installSize?.files ?? 0,
         sharedBytes: sharedSize?.bytes ?? 0,
         sharedFiles: sharedSize?.files ?? 0,
         conflictCount: conflicts,
         conflictPath: conflicts > 0 ? conflictFolderPath(resolved.folderPath) : null,
         backupPath,
         linkedInstalls: linkedInstalls.map((install) => install.name),
         warnings
      };
   }

   async function start(request: SharedContentActionRequest): Promise<SharedContentOperationResult> {
      const previewed = await preview(request);
      if (previewed.status === 'invalid') return failure(request.installId, previewed.issue, previewed.detail);

      const resolved = await resolveFolder(request);
      if (resolved.status === 'invalid') return failure(request.installId, resolved.issue, resolved.detail);

      const controller = new AbortController();
      const total = request.action === 'link' ? previewed.installBytes : previewed.sharedBytes;
      const operation = options.operations.create({
         kind: 'copy',
         title: `${request.action === 'link' ? 'Share' : request.action === 'unlink' ? 'Stop sharing' : 'Repair'} ${previewed.relativePath}`,
         message: previewed.sharedFolderPath,
         progress: { phase: 'preparing', current: 0, total, percent: 0, unit: 'bytes' },
         metadata: { installId: request.installId, folderId: previewed.folderId, action: request.action, contents: previewed.contents },
         cancel: () => controller.abort()
      });

      void run(operation.id, previewed, resolved, controller.signal);

      return { ok: true, value: operation };
   }

   async function run(operationId: string, previewed: ReadySharedContentPreview, context: FolderContext, signal: AbortSignal) {
      const outcome = await (previewed.action === 'link'
         ? transfers.runLink(operationId, previewed, context, signal)
         : previewed.action === 'unlink'
           ? transfers.runUnlink(operationId, previewed, context, signal)
           : transfers.runRepair(context));

      await rescan(previewed);

      if (Result.isError(outcome)) return failOperation(operationId, outcome.error);

      const completed: SharedContentOutcome = {
         installId: previewed.installId,
         folderId: previewed.folderId,
         action: previewed.action,
         ...outcome.value
      };
      options.operations.complete(operationId, completed);
   }

   async function previewConnect(request: SharedConnectRequest): Promise<SharedConnectPreview> {
      const install = await options.registry.get(request.installId);
      if (!install) return invalidSharedConnect(request, 'install-not-found');

      const library = await readLibrary();
      const rootPath = request.rootPath ? findKnownRoot(library, request.rootPath) : library.sharedRootPath;
      if (!rootPath) return invalidSharedConnect(request, 'unknown-root');

      // probing link support creates the root, so remember whether it existed first
      const rootExists = await pathExistsSafely(rootPath);
      const support = await readLinkSupport(rootPath, library.useSymlinks);
      if (request.action === 'connect' && !support.supported) {
         return invalidSharedConnect(request, 'link-unsupported', support.detail ?? undefined);
      }

      const contents = readConnectContents(request);
      const includeRisky = request.includeRisky ?? false;
      const folders: SharedConnectFolderPlan[] = [];
      const warnings = new Set<SharedContentWarning>();
      let riskyHeldBack = false;

      for (const definition of sharedFolderDefinitions) {
         const status = await readFolderStatus(install.path, rootPath, definition, library.rootPaths);
         const step = planConnectStep(request.action, status, rootPath, includeRisky);
         // a risky folder skipped only because it is opt-out keeps the preview alive so the toggle shows
         if (step === 'skip' && status.risky && !includeRisky && planConnectStep(request.action, status, rootPath, true) !== 'skip') {
            riskyHeldBack = true;
         }
         let bytes = 0;
         let files = 0;
         let conflictCount = 0;

         if (step === 'link' && status.state === 'unlinked') {
            const size = await readSize(status.installFolderPath);
            bytes = size?.bytes ?? 0;
            files = size?.files ?? 0;
            if (contents === 'move') conflictCount = await countConflicts(status.state, status.installFolderPath, status.sharedFolderPath);
            if (contents === 'discard' && files > 0) warnings.add('discards-contents');
            if (contents === 'move' && files > 0 && (await pathExistsSafely(status.sharedFolderPath))) warnings.add('merges-into-shared');
            if (conflictCount > 0) warnings.add('name-conflicts');
         }

         if (step === 'unlink' && contents === 'copy') {
            const size = await readSize(status.sharedFolderPath);
            bytes = size?.bytes ?? 0;
            files = size?.files ?? 0;
         }

         if (step !== 'skip' && definition.risky) warnings.add('risky-folder');

         folders.push({
            id: definition.id,
            relativePath: sharedFolderRelativePath(definition),
            state: status.state,
            rootPath: status.rootPath,
            step,
            bytes,
            files,
            conflictCount,
            risky: definition.risky
         });
      }

      if (!riskyHeldBack && folders.every((folder) => folder.step === 'skip')) return invalidSharedConnect(request, 'nothing-to-connect');

      if (request.action === 'connect' && !rootExists) warnings.add('creates-shared-folder');
      if (request.action === 'disconnect') warnings.add('shared-kept');

      return {
         status: 'ok',
         installId: request.installId,
         action: request.action,
         rootPath,
         linkMode: support.mode,
         contents,
         includeRisky,
         folders,
         warnings: [...warnings]
      };
   }

   async function startConnect(request: SharedConnectRequest): Promise<SharedContentOperationResult> {
      const previewed = await previewConnect(request);
      if (previewed.status === 'invalid') return failure(request.installId, previewed.issue, previewed.detail);

      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'install-not-found');

      const controller = new AbortController();
      const total = previewed.folders.reduce((sum, folder) => sum + folder.bytes, 0);
      const operation = options.operations.create({
         kind: 'copy',
         title: `${previewed.action === 'connect' ? 'Connect' : 'Disconnect'} ${install.name}`,
         message: previewed.rootPath,
         progress: { phase: 'preparing', current: 0, total, percent: 0, unit: 'bytes' },
         metadata: { installId: request.installId, action: previewed.action, rootPath: previewed.rootPath, contents: previewed.contents },
         cancel: () => controller.abort()
      });

      void runConnect(operation.id, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runConnect(operationId: string, previewed: ReadySharedConnectPreview, signal: AbortSignal) {
      const outcome: SharedConnectOutcome = {
         installId: previewed.installId,
         action: previewed.action,
         rootPath: previewed.rootPath,
         folders: 0,
         bytes: 0,
         files: 0,
         conflicts: 0
      };

      // per-folder transfers report against the whole run, not their own size
      const total = previewed.folders.reduce((sum, folder) => sum + folder.bytes, 0);
      let carried = 0;

      for (const plan of previewed.folders) {
         if (plan.step === 'skip') continue;
         if (signal.aborted) break;

         const action: SharedContentAction = plan.step === 'link' ? 'link' : plan.step === 'repair' ? 'repair' : 'unlink';
         const contents = await folderConnectContents(previewed, plan, action);
         const request: SharedContentActionRequest = {
            installId: previewed.installId,
            folderId: plan.id,
            action,
            contents
         };

         const folderPreview = await preview(request, previewed.rootPath);
         // a folder that changed on disk since the preview is skipped, not fatal
         if (folderPreview.status === 'invalid') continue;

         const resolved = await resolveFolder(request, previewed.rootPath);
         if (resolved.status === 'invalid') continue;

         const frame = { offset: carried, total };
         const stepOutcome = await (action === 'link'
            ? transfers.runLink(operationId, folderPreview, resolved, signal, frame)
            : action === 'unlink'
              ? transfers.runUnlink(operationId, folderPreview, resolved, signal, frame)
              : transfers.runRepair(resolved));

         if (Result.isError(stepOutcome)) {
            await rescan(previewed);
            return failOperation(operationId, stepOutcome.error);
         }

         carried += plan.bytes;
         outcome.folders += 1;
         outcome.bytes += stepOutcome.value.bytes;
         outcome.files += stepOutcome.value.files;
         outcome.conflicts += stepOutcome.value.conflicts;
      }

      await rescan(previewed);
      options.operations.complete(operationId, outcome);
   }

   async function folderConnectContents(
      previewed: ReadySharedConnectPreview,
      plan: SharedConnectFolderPlan,
      action: SharedContentAction
   ): Promise<SharedContentsMode> {
      if (action === 'repair') return 'keep';
      if (action === 'link') return previewed.contents === 'discard' ? 'discard' : 'move';

      // copying back from a shared folder that is gone would fail, keep an empty folder instead
      const definition = findSharedFolderDefinition(plan.id);
      const sourcePath = definition ? sharedFolderPath(previewed.rootPath, definition) : null;
      if (previewed.contents === 'copy' && sourcePath && (await pathExistsSafely(sourcePath))) return 'copy';

      return 'keep';
   }

   function planConnectStep(
      action: SharedConnectRequest['action'],
      status: SharedFolderStatus,
      rootPath: string,
      includeRisky: boolean
   ): SharedConnectStep {
      const linkedHere = status.state === 'linked' && status.rootPath !== null && isSamePath(status.rootPath, rootPath);

      if (action === 'disconnect') {
         if (linkedHere || status.state === 'broken' || status.state === 'foreign') return 'unlink';

         return 'skip';
      }

      if (status.risky && !includeRisky) return 'skip';
      if (status.state === 'absent' || status.state === 'unlinked') return 'link';
      if (status.state === 'broken' || status.state === 'foreign') return 'repair';
      if (status.state === 'linked' && !linkedHere) return 'repair';

      return 'skip';
   }

   async function chooseRootCandidate(input: SharedRootRequest) {
      const { path } = input;
      const resolvedPath = resolveFilesystemPath(path);
      const library = await readLibrary();
      const exists = await pathExistsSafely(resolvedPath);
      const foldersFound: SharedFolderId[] = [];

      for (const definition of sharedFolderDefinitions) {
         if (await pathExistsSafely(sharedFolderPath(resolvedPath, definition))) foldersFound.push(definition.id);
      }

      return {
         path: resolvedPath,
         exists,
         alreadyKnown: findKnownRoot(library, resolvedPath) !== null,
         foldersFound
      };
   }

   async function addRoot({ path, activate = false }: { path: string; activate?: boolean }): Promise<SharedRootActionResult> {
      const resolvedPath = resolveFilesystemPath(path);

      // a root at or inside an install would make its folders both link source and destination
      const registrySnapshot = await options.registry.list();
      const overlapsInstall = registrySnapshot.installs.some(
         (install) => isSamePath(resolvedPath, install.path) || isPathInside(install.path, resolvedPath)
      );
      if (overlapsInstall) return { status: 'invalid', issue: 'root-inside-install' };

      const created = await Result.tryPromise({
         try: () => mkdir(resolvedPath, { recursive: true }),
         catch: (cause) => (cause instanceof Error ? cause.message : String(cause))
      });
      if (Result.isError(created)) return { status: 'invalid', issue: 'create-failed', detail: created.error };

      return updateRoots((library) => {
         if (activate) return activationPatch(library, resolvedPath);
         if (findKnownRoot(library, resolvedPath)) return {};

         return { sharedRoots: [...otherRoots(library, resolvedPath), resolvedPath] };
      });
   }

   async function activateRoot(input: SharedRootRequest): Promise<SharedRootActionResult> {
      const { path } = input;
      const resolvedPath = resolveFilesystemPath(path);
      const library = await readLibrary();
      if (!findKnownRoot(library, resolvedPath)) return { status: 'invalid', issue: 'root-unknown' };

      return updateRoots(() => activationPatch(library, resolvedPath));
   }

   async function forgetRoot(input: SharedRootRequest): Promise<SharedRootActionResult> {
      const { path } = input;
      const resolvedPath = resolveFilesystemPath(path);
      const library = await readLibrary();
      if (isSamePath(resolvedPath, library.sharedRootPath)) return { status: 'invalid', issue: 'root-active' };
      if (!findKnownRoot(library, resolvedPath)) return { status: 'invalid', issue: 'root-unknown' };

      return updateRoots(() => ({ sharedRoots: otherRoots(library, resolvedPath) }));
   }

   async function updateRoots(patch: (library: Library) => LibrarySettingsPatch): Promise<SharedRootActionResult> {
      const library = await readLibrary();
      const written = await options.settingsStore.updateLibrarySettings(patch(library));
      if (!written.ok) return { status: 'invalid', issue: 'create-failed', detail: written.error.message };

      cachedSupport = null;
      cachedSupportRoot = null;
      void rescanAll();

      return { status: 'ok' };
   }

   function activationPatch(library: Library, rootPath: string): LibrarySettingsPatch {
      // the previous active root stays known, so installs can hop back later
      return {
         sharedRoot: rootPath,
         sharedRoots: [...otherRoots(library, rootPath), library.sharedRootPath].filter((root) => !isSamePath(root, rootPath))
      };
   }

   function otherRoots(library: Library, rootPath: string) {
      return library.rootPaths.filter((root) => !isSamePath(root, rootPath) && !isSamePath(root, library.sharedRootPath));
   }

   async function isKnownRoot(path: string) {
      const library = await readLibrary();

      return findKnownRoot(library, path) !== null;
   }

   async function rescanAll() {
      const registrySnapshot = await options.registry.list();
      for (const install of registrySnapshot.installs) {
         await scan(install.id, true).catch(() => undefined);
      }
   }

   async function resolveFolder(request: SharedFolderRequest & { action?: SharedContentAction }, rootPath?: string): Promise<ResolvedFolder> {
      const definition = findSharedFolderDefinition(request.folderId);
      if (!definition) return { status: 'invalid', issue: 'unknown-folder' };

      const install = await options.registry.get(request.installId);
      if (!install) return { status: 'invalid', issue: 'install-not-found' };

      const library = await readLibrary();
      const requestedRoot = rootPath ? findKnownRoot(library, rootPath) : library.sharedRootPath;
      if (!requestedRoot) return { status: 'invalid', issue: 'unknown-root' };

      const support = await readLinkSupport(requestedRoot, library.useSymlinks);
      const status = await readFolderStatus(install.path, requestedRoot, definition, library.rootPaths);

      // unlinking reads content back from wherever the link actually points, not the requested root
      const linkedRoot = status.state === 'linked' && status.rootPath !== null ? status.rootPath : null;
      const contentRoot = request.action === 'unlink' && linkedRoot ? linkedRoot : requestedRoot;

      return {
         status: 'ok',
         install,
         sharedRootPath: contentRoot,
         definition,
         folderPath: status.installFolderPath,
         sharedFolderPath: sharedFolderPath(contentRoot, definition),
         state: status.state,
         linkedRootPath: linkedRoot,
         support
      };
   }

   function actionIssue(action: SharedContentAction, context: FolderContext): SharedContentIssue | null {
      if (context.state === 'blocked') return 'path-blocked';
      if (action !== 'unlink' && !context.support.supported) return 'link-unsupported';

      if (action === 'link') return context.state === 'absent' || context.state === 'unlinked' ? null : 'already-linked';
      if (action === 'unlink') return context.state === 'absent' || context.state === 'unlinked' ? 'not-linked' : null;

      if (context.state === 'broken' || context.state === 'foreign') return null;

      // repair also repoints a healthy link that belongs to a different root
      const linkedElsewhere =
         context.state === 'linked' && context.linkedRootPath !== null && !isSamePath(context.linkedRootPath, context.sharedRootPath);

      return linkedElsewhere ? null : 'not-linked';
   }

   async function readFolderStatus(
      installPath: string,
      rootPath: string,
      definition: SharedFolderDefinition,
      knownRoots: string[]
   ): Promise<SharedFolderStatus> {
      const folderPath = installFolderPath(installPath, definition);
      const sharedPath = sharedFolderPath(rootPath, definition);
      const link = await readFolderLink(folderPath, sharedPath);
      let state = link.state;
      let linkedRoot = state === 'linked' ? rootPath : null;

      // a link into any other known root is a healthy link, not a foreign one
      if (state === 'foreign' && link.linkTargetPath) {
         const target = link.linkTargetPath;
         const matched = knownRoots.find((root) => isSamePath(target, sharedFolderPath(root, definition)));
         if (matched) {
            state = 'linked';
            linkedRoot = matched;
         }
      }

      return {
         id: definition.id,
         kind: definition.kind,
         relativePath: sharedFolderRelativePath(definition),
         installFolderPath: folderPath,
         sharedFolderPath: sharedPath,
         state,
         linkTargetPath: link.linkTargetPath,
         rootPath: linkedRoot,
         risky: definition.risky
      };
   }

   async function findLinkedInstalls(context: FolderContext) {
      const registrySnapshot = await options.registry.list();
      const library = await readLibrary();
      const linked: InstallSummary[] = [];

      for (const install of registrySnapshot.installs) {
         if (install.id === context.install.id) continue;

         const status = await readFolderStatus(install.path, context.sharedRootPath, context.definition, library.rootPaths);
         if (status.state === 'linked' && status.rootPath !== null && isSamePath(status.rootPath, context.sharedRootPath)) linked.push(install);
      }

      return linked;
   }

   async function countConflicts(state: SharedFolderStatus['state'], folderPath: string, sharedPath: string) {
      if (state !== 'unlinked') return 0;

      const source = await readEntries(folderPath);
      const destination = await readEntries(sharedPath);
      if (destination.size === 0) return 0;

      return [...source].filter((name) => destination.has(name)).length;
   }

   async function readEntries(targetPath: string) {
      const entries = await Result.tryPromise({
         try: () => readdir(targetPath),
         catch: (cause) => cause
      });

      return new Set(Result.isOk(entries) ? entries.value : []);
   }

   async function readSize(targetPath: string) {
      const size = await getDirectorySize(targetPath);

      return Result.isOk(size) ? size.value : null;
   }

   async function readLibrary(): Promise<Library> {
      const settings = await options.settingsStore.getSnapshot();
      const sharedRootPath = settings.library.sharedRoot ?? defaultSharedContentRootPath(settings.library.installRoot);
      const rootPaths = [sharedRootPath];

      for (const root of settings.library.sharedRoots) {
         if (!rootPaths.some((known) => isSamePath(known, root))) rootPaths.push(root);
      }

      return {
         installRoot: settings.library.installRoot,
         sharedRootPath,
         rootPaths,
         useSymlinks: settings.library.useSymlinks
      };
   }

   function findKnownRoot(library: Library, path: string) {
      return library.rootPaths.find((root) => isSamePath(root, path)) ?? null;
   }

   async function readLinkSupport(rootPath: string, useSymlinks: boolean, force = false) {
      const requestedMode = preferredLinkMode(platform, useSymlinks);
      if (!force && cachedSupport && cachedSupportRoot === rootPath && cachedSupport.requestedMode === requestedMode) return cachedSupport;

      cachedSupport = await probeLinkSupport(rootPath, requestedMode);
      cachedSupportRoot = rootPath;

      return cachedSupport;
   }

   function readContentsMode(request: SharedContentActionRequest) {
      const contents = request.contents ?? defaultContentsMode(request.action);

      return isContentsModeAllowed(request.action, contents) ? contents : defaultContentsMode(request.action);
   }

   function readConnectContents(request: SharedConnectRequest) {
      const contents = request.contents ?? defaultConnectContents(request.action);

      return isConnectContentsAllowed(request.action, contents) ? contents : defaultConnectContents(request.action);
   }

   function publish(snapshot: SharedContentSnapshot) {
      setRecent(snapshots, snapshot.installId, snapshot, maxCachedSnapshots);

      return events.publish(snapshot);
   }

   function dispose() {
      events.dispose();
      snapshots.clear();
   }

   return {
      list,
      rescan,
      getOverview,
      getFolderPath,
      preview,
      start,
      previewConnect,
      startConnect,
      chooseRootCandidate,
      addRoot,
      activateRoot,
      forgetRoot,
      isKnownRoot,
      subscribe: events.subscribe,
      dispose
   };
}
