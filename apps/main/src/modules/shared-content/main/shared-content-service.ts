import { Result } from 'better-result';

import type { IpcFailureResult } from '@/ipc/core';
import { readRecent, setRecent } from '@/lib/content/content-cache';
import { causeMessage, createProblem } from '@/lib/errors';
import { createContentEvents } from '@/lib/events';
import { isSamePath, pathExistsSafely } from '@/lib/filesystem/path';
import { translate } from '@/lib/messages';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import {
   createEmptySharedContentOverview,
   createEmptySharedContentSnapshot,
   defaultConnectContents,
   defaultContentsMode,
   invalidSharedConnect,
   invalidSharedContentAction,
   isConnectContentsAllowed,
   isContentsModeAllowed,
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
   type SharedFolderInstallLink,
   type SharedFolderOverview,
   type SharedFolderRequest,
   type SharedFolderStatus,
   type SharedInstallOverview,
   type SharedRootOverview
} from '@/modules/shared-content/contract';
import { createSharedContentTransfers, type FolderContext } from '@/modules/shared-content/main/shared-content-transfer';
import {
   countConflicts,
   createLinkSupportCache,
   findLinkedInstalls,
   readFolderStatus,
   readSize
} from '@/modules/shared-content/main/shared-folder-status';
import { createSharedLibrary, findKnownRoot, isRootInsideInstall } from '@/modules/shared-content/main/shared-library';
import { backupFolderPath, conflictFolderPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { dirname } from 'node:path';

function failure(installId: InstallId, issue: SharedContentIssue, detail?: string): IpcFailureResult {
   return { ok: false, error: createProblem(`shared-content.${issue}`, { installId, detail }) };
}

type SharedContentServiceOptions = {
   registry: InstallRegistry;
   settingsStore: SettingsStore;
   operations: OperationRegistry;
   log: AppLogWriter;
   platform?: NodeJS.Platform;
};

type ResolvedFolder = { status: 'invalid'; issue: SharedContentIssue; detail?: string } | ({ status: 'ok' } & FolderContext);

export type SharedContentService = ReturnType<typeof createSharedContentService>;

export function createSharedContentService(options: SharedContentServiceOptions) {
   const platform = options.platform ?? process.platform;
   const snapshots = new Map<InstallId, SharedContentSnapshot>();
   const scanGenerations = new Map<InstallId, number>();
   const activeInstalls = new Set<InstallId>();
   let disposed = false;
   const isDisposed = () => disposed;
   const maxCachedSnapshots = 12;
   const events = createContentEvents<SharedContentSnapshot>();
   const transfers = createSharedContentTransfers(options.operations);
   const readLinkSupport = createLinkSupportCache(platform);
   const sharedLibrary = createSharedLibrary({ registry: options.registry, settingsStore: options.settingsStore, onChange: () => void rescanAll() });

   async function list(input: SharedContentRequest) {
      return readRecent(snapshots, input.installId) ?? scan(input.installId);
   }

   async function rescan(input: SharedContentRequest) {
      return scan(input.installId, true);
   }

   async function scan(installId: InstallId, force = false): Promise<SharedContentSnapshot> {
      const generation = (scanGenerations.get(installId) ?? 0) + 1;
      scanGenerations.set(installId, generation);

      const install = await options.registry.get(installId);
      if (!install) {
         const missing = createEmptySharedContentSnapshot({ installId }, 'missing');
         if (isDisposed() || scanGenerations.get(installId) !== generation) return missing;
         return publish(missing);
      }

      const library = await sharedLibrary.read();
      const sharedRootPath = library.sharedRootPath;
      const support = await readLinkSupport(sharedRootPath, library.useSymlinks, force);
      const problems: SharedContentProblem[] = [];
      const folders: SharedFolderStatus[] = [];

      for (const definition of library.definitions) {
         folders.push(await readFolderStatus(install.path, sharedRootPath, definition, library.rootPaths));
      }

      if (!support.supported) {
         problems.push(createProblem('shared.support.failed', { path: sharedRootPath, detail: support.detail ?? undefined }));
      }

      const snapshot: SharedContentSnapshot = {
         installId,
         status: 'ready',
         installPath: install.path,
         sharedRootPath,
         linkSupport: support,
         folders,
         problems,
         scannedAt: new Date().toISOString()
      };
      if (isDisposed() || scanGenerations.get(installId) !== generation) return snapshot;
      return publish(snapshot);
   }

   async function getOverview(): Promise<SharedContentOverview> {
      const registrySnapshot = await options.registry.list();
      const library = await sharedLibrary.read();
      const sharedRootPath = library.sharedRootPath;
      const support = await readLinkSupport(sharedRootPath, library.useSymlinks);

      const installs: SharedInstallOverview[] = [];
      for (const install of registrySnapshot.installs) {
         const statuses: SharedFolderStatus[] = [];
         for (const definition of library.definitions) {
            statuses.push(await readFolderStatus(install.path, sharedRootPath, definition, library.rootPaths));
         }

         installs.push({ installId: install.id, installName: install.name, installPath: install.path, folders: statuses });
      }

      const roots: SharedRootOverview[] = [];
      for (const rootPath of library.rootPaths) {
         const folders = [];
         for (const definition of library.definitions) {
            const folderPath = sharedFolderPath(rootPath, definition);
            folders.push({
               id: definition.id,
               relativePath: sharedFolderRelativePath(definition),
               path: folderPath,
               exists: await pathExistsSafely(folderPath)
            });
         }

         roots.push({
            path: rootPath,
            active: isSamePath(rootPath, sharedRootPath),
            exists: await pathExistsSafely(rootPath),
            folders
         });
      }

      // the folder-centric view stays scoped to the active root
      const folders: SharedFolderOverview[] = library.definitions.map((definition) => {
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
      const library = await sharedLibrary.read();
      const definition = library.definitions.find((candidate) => candidate.id === request.folderId);
      if (!definition) return null;

      return sharedFolderPath(library.sharedRootPath, definition);
   }

   async function preview(request: SharedContentActionRequest, rootPath?: string): Promise<SharedContentPreview> {
      const evaluated = await previewResolved(request, rootPath);
      return evaluated.preview;
   }

   async function previewResolved(
      request: SharedContentActionRequest,
      rootPath?: string
   ): Promise<
      | { status: 'ok'; preview: ReadySharedContentPreview; context: FolderContext }
      | { status: 'invalid'; preview: Exclude<SharedContentPreview, ReadySharedContentPreview> }
   > {
      const resolved = await resolveFolder(request, rootPath);
      if (resolved.status === 'invalid') return { status: 'invalid', preview: invalidSharedContentAction(request, resolved.issue, resolved.detail) };

      const issue = actionIssue(request.action, resolved);
      if (issue) return { status: 'invalid', preview: invalidSharedContentAction(request, issue) };

      const contents = readContentsMode(request);
      const warnings: SharedContentWarning[] = [];
      const installSize = resolved.state === 'unlinked' ? await readSize(resolved.folderPath) : null;
      const sharedSize = await readSize(resolved.sharedFolderPath);
      const linkedInstalls = await findLinkedInstalls((await options.registry.list()).installs, resolved);
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
         preview: {
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
         },
         context: resolved
      };
   }

   async function start(request: SharedContentActionRequest): Promise<SharedContentOperationResult> {
      if (activeInstalls.has(request.installId)) {
         return { ok: false, error: createProblem('shared-content.start-failed', { detail: 'another shared content operation is already running' }) };
      }

      activeInstalls.add(request.installId);
      const evaluated = await previewResolved(request);
      if (evaluated.status === 'invalid') {
         activeInstalls.delete(request.installId);
         return failure(request.installId, evaluated.preview.issue, evaluated.preview.detail);
      }

      const previewed = evaluated.preview;
      const context = evaluated.context;
      const total = request.action === 'link' ? previewed.installBytes : previewed.sharedBytes;
      const operation = options.operations.start(
         {
            kind: 'copy',
            title: translate('sharedContent.operations.folder', { action: request.action, path: previewed.relativePath }),
            message: previewed.sharedFolderPath,
            progress: { phase: 'preparing', current: 0, total, percent: 0, unit: 'bytes' },
            metadata: { installId: request.installId, folderId: previewed.folderId, action: request.action, contents: previewed.contents }
         },
         (operationId, signal) => run(operationId, previewed, context, signal)
      );

      return { ok: true, value: operation };
   }

   async function run(operationId: string, previewed: ReadySharedContentPreview, context: FolderContext, signal: AbortSignal) {
      try {
         const outcome = await (previewed.action === 'link'
            ? transfers.runLink(operationId, previewed, context, signal)
            : previewed.action === 'unlink'
              ? transfers.runUnlink(operationId, previewed, context, signal)
              : transfers.runRepair(context));

         await rescan(previewed);

         if (Result.isError(outcome)) return options.operations.fail(operationId, outcome.error);

         const completed: SharedContentOutcome = {
            installId: previewed.installId,
            folderId: previewed.folderId,
            action: previewed.action,
            ...outcome.value
         };
         options.operations.complete(operationId, completed);
      } finally {
         activeInstalls.delete(previewed.installId);
      }
   }

   async function previewConnect(request: SharedConnectRequest): Promise<SharedConnectPreview> {
      const install = await options.registry.get(request.installId);
      if (!install) return invalidSharedConnect(request, 'install-not-found');

      const library = await sharedLibrary.read();
      const rootPath = request.rootPath ? findKnownRoot(library, request.rootPath) : library.sharedRootPath;
      if (!rootPath) return invalidSharedConnect(request, 'unknown-root');

      // probing link support creates the root, so remember whether it existed first
      const rootExists = await pathExistsSafely(rootPath);
      const support = await readLinkSupport(rootPath, library.useSymlinks);
      if (request.action === 'connect' && !support.supported) {
         return invalidSharedConnect(request, 'link-unsupported', support.detail ?? undefined);
      }

      if (request.action === 'connect' && (await isRootInsideInstall(rootPath, install.path))) {
         return invalidSharedConnect(request, 'root-inside-install');
      }

      const contents = readConnectContents(request);
      const includeRisky = request.includeRisky ?? false;
      const folders: SharedConnectFolderPlan[] = [];
      const warnings = new Set<SharedContentWarning>();
      let riskyHeldBack = false;

      for (const definition of library.definitions) {
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
      if (activeInstalls.has(request.installId)) {
         return { ok: false, error: createProblem('shared-content.start-failed', { detail: 'another shared content operation is already running' }) };
      }

      activeInstalls.add(request.installId);
      const previewed = await previewConnect(request);
      if (previewed.status === 'invalid') {
         activeInstalls.delete(request.installId);
         return failure(request.installId, previewed.issue, previewed.detail);
      }

      const install = await options.registry.get(request.installId);
      if (!install) {
         activeInstalls.delete(request.installId);
         return failure(request.installId, 'install-not-found');
      }

      const total = previewed.folders.reduce((sum, folder) => sum + folder.bytes, 0);
      const operation = options.operations.start(
         {
            kind: 'copy',
            title: translate('sharedContent.operations.install', { action: previewed.action, name: install.name }),
            message: previewed.rootPath,
            progress: { phase: 'preparing', current: 0, total, percent: 0, unit: 'bytes' },
            metadata: { installId: request.installId, action: previewed.action, rootPath: previewed.rootPath, contents: previewed.contents }
         },
         (operationId, signal) => runConnect(operationId, previewed, signal)
      );

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

      try {
         for (const plan of previewed.folders) {
            if (plan.step === 'skip') continue;
            if (signal.aborted) {
               await rescan(previewed);
               return options.operations.fail(operationId, createProblem('filesystem.operation.cancelled'));
            }

            const action: SharedContentAction = plan.step === 'link' ? 'link' : plan.step === 'repair' ? 'repair' : 'unlink';
            const contents = folderConnectContents(previewed, action);
            const request: SharedContentActionRequest = {
               installId: previewed.installId,
               folderId: plan.id,
               action,
               contents
            };

            const evaluated = await previewResolved(request, previewed.rootPath);
            // a folder that changed on disk since the preview is skipped, not fatal
            if (evaluated.status === 'invalid') continue;

            const frame = { offset: carried, total };
            const stepOutcome = await (action === 'link'
               ? transfers.runLink(operationId, evaluated.preview, evaluated.context, signal, frame)
               : action === 'unlink'
                 ? transfers.runUnlink(operationId, evaluated.preview, evaluated.context, signal, frame)
                 : transfers.runRepair(evaluated.context));

            if (Result.isError(stepOutcome)) {
               await rescan(previewed);
               return options.operations.fail(operationId, stepOutcome.error);
            }

            carried += plan.bytes;
            outcome.folders += 1;
            outcome.bytes += stepOutcome.value.bytes;
            outcome.files += stepOutcome.value.files;
            outcome.conflicts += stepOutcome.value.conflicts;
         }

         await rescan(previewed);
         if (signal.aborted) return options.operations.fail(operationId, createProblem('filesystem.operation.cancelled'));

         options.operations.complete(operationId, outcome);
      } finally {
         activeInstalls.delete(previewed.installId);
      }
   }

   function folderConnectContents(previewed: ReadySharedConnectPreview, action: SharedContentAction): SharedContentsMode {
      if (action === 'repair') return 'keep';
      if (action === 'link') return previewed.contents === 'discard' ? 'discard' : 'move';

      return previewed.contents === 'copy' ? 'copy' : 'keep';
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

   async function rescanAll() {
      const registrySnapshot = await options.registry.list();
      for (const install of registrySnapshot.installs) {
         const scanned = await Result.tryPromise({ try: () => scan(install.id, true), catch: (cause) => cause });
         if (Result.isError(scanned)) void options.log.warn(`shared-content: shared.rescan.failed ${causeMessage(scanned.error)}`);
      }
   }

   async function resolveFolder(request: SharedFolderRequest & { action?: SharedContentAction }, rootPath?: string): Promise<ResolvedFolder> {
      const install = await options.registry.get(request.installId);
      if (!install) return { status: 'invalid', issue: 'install-not-found' };

      const library = await sharedLibrary.read();
      const definition = library.definitions.find((candidate) => candidate.id === request.folderId);
      if (!definition) return { status: 'invalid', issue: 'unknown-folder' };
      const requestedRoot = rootPath ? findKnownRoot(library, rootPath) : library.sharedRootPath;
      if (!requestedRoot) return { status: 'invalid', issue: 'unknown-root' };

      const support = await readLinkSupport(requestedRoot, library.useSymlinks);
      const status = await readFolderStatus(install.path, requestedRoot, definition, library.rootPaths);

      if (request.action !== 'unlink' && (await isRootInsideInstall(requestedRoot, install.path))) {
         return { status: 'invalid', issue: 'root-inside-install' };
      }

      // unlinking reads content back from wherever the link actually points, not the requested root
      const linkedRoot = status.state === 'linked' && status.rootPath !== null ? status.rootPath : null;
      const unknownTarget = request.action === 'unlink' && status.state !== 'linked' ? status.linkTargetPath : null;
      const contentRoot = unknownTarget ? dirname(unknownTarget) : request.action === 'unlink' && linkedRoot ? linkedRoot : requestedRoot;

      return {
         status: 'ok',
         install,
         sharedRootPath: contentRoot,
         definition,
         folderPath: status.installFolderPath,
         sharedFolderPath: unknownTarget ?? sharedFolderPath(contentRoot, definition),
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
      disposed = true;
      events.dispose();
      snapshots.clear();
      scanGenerations.clear();
      activeInstalls.clear();
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
      chooseCustomFolder: sharedLibrary.chooseCustomFolder,
      addCustomFolder: sharedLibrary.addCustomFolder,
      forgetCustomFolder: sharedLibrary.forgetCustomFolder,
      chooseRootCandidate: sharedLibrary.chooseRootCandidate,
      addRoot: sharedLibrary.addRoot,
      activateRoot: sharedLibrary.activateRoot,
      forgetRoot: sharedLibrary.forgetRoot,
      isKnownRoot: sharedLibrary.isKnownRoot,
      subscribe: events.subscribe,
      dispose
   };
}
