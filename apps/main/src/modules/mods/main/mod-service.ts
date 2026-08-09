import { Result } from 'better-result';

import { readRecent, setRecent } from '@/lib/content/content-cache';
import { createPersistentCache } from '@/lib/content/content-cache';
import { createContentFailure } from '@/lib/content/content-errors';
import type { ContentIngestionService } from '@/lib/content/content-ingestion';
import type { ContentProblem } from '@/lib/content/contract';
import { copyPathWithProgress, deletePathWithProgress } from '@/lib/filesystem/operations';
import { isSamePath, readPathInfo } from '@/lib/filesystem/path';
import type { InstallDetail, InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   bsipaModName,
   invalidModAction,
   modPlatformForStore,
   readyModsSnapshotSchema,
   unavailableModsSnapshot,
   type ModChangesPreview,
   type ModChangesRequest,
   type ModImportPreview,
   type ModImportRequest,
   type ModInstallPreview,
   type ModIssue,
   type ModOperationResult,
   type ModPlatform,
   type ModRemoval,
   type ModRequest,
   type ModSelectionRequest,
   type ModsSnapshot,
   type ModUninstallPreview,
   type ModUninstallRequest,
   type ModWarning,
   type ReadyModsSnapshot,
   type ReadyModChangesPreview,
   type ReadyModImportPreview,
   type ReadyModUninstallPreview
} from '@/modules/mods/contract';
import { createModCatalogService, type ModCatalogService } from '@/modules/mods/main/mod-catalog';
import type { ModIndex } from '@/modules/mods/main/mod-index';
import { importModArchive, installModVersion, maxModArchiveBytes } from '@/modules/mods/main/mod-install';
import { createModPatcher, type ModPatcher } from '@/modules/mods/main/mod-patcher';
import { modFileCandidates, modFolders, modRemovableFolders, resolveModContentPath } from '@/modules/mods/main/mod-paths';
import { buildInstallPlan, percentOf, progressFor, summarizeMods, toPlanEntry, type PlannedMod } from '@/modules/mods/main/mod-plan';
import { scanInstalledMods, type ModScan } from '@/modules/mods/main/mod-scan';
import type { OperationError } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

import { basename, extname, join } from 'node:path';

const issueMessages: Record<ModIssue, string> = {
   'catalog-unavailable': 'BeatMods could not be reached',
   'inspect-failed': 'the install folder could not be inspected',
   'not-found': 'the install is not in the registry anymore',
   'nothing-selected': 'no mod was selected',
   'unknown-version': 'the Beat Saber version of this install is unknown',
   'unsupported-file': 'only a .dll or a .zip can be imported as a mod',
   'unsupported-target': 'this target cannot manage mods'
};

const importExtensions = ['.dll', '.zip'];

export type ModServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   ingestion: ContentIngestionService;
   dataPath: string;
   catalog?: ModCatalogService;
   patcher?: ModPatcher;
};

export type ModService = ReturnType<typeof createModService>;

type ModContext = {
   install: InstallDetail;
   gameVersion: string;
   platform: ModPlatform;
   index: ModIndex;
};

type ModProblem = {
   issue: ModIssue;
   detail?: string;
};

export function createModService(options: ModServiceOptions) {
   const catalogs = options.catalog ?? createModCatalogService({ dataPath: options.dataPath });
   const patcher = options.patcher ?? createModPatcher();
   const modFailure = createContentFailure<ModIssue>('mods', issueMessages);
   const scans = new Map<InstallId, { installPath: string; scan: ModScan }>();
   const snapshots = createPersistentCache({ dataPath: options.dataPath, name: 'mods', valueSchema: readyModsSnapshotSchema, maxEntries: 12 });
   const maxCachedScans = 8;

   async function getMods(request: ModRequest): Promise<ModsSnapshot> {
      const install = await options.registry.get(request.installId);
      if (install?.version) {
         const platform = modPlatformForStore(install.store);
         const correlation = `${install.path}\0${platform}\0${install.version}`;
         const cached = await snapshots.get(request.installId, correlation);
         if (cached) return { ...cached, installId: request.installId, source: 'cache' };
      }

      return snapshot(request, false);
   }

   async function refreshMods(request: ModRequest): Promise<ModsSnapshot> {
      return snapshot(request, true);
   }

   async function snapshot(request: ModRequest, refresh: boolean): Promise<ModsSnapshot> {
      const context = await loadContext(request.installId, refresh);
      if (Result.isError(context)) return unavailableModsSnapshot(request, context.error.issue, context.error.detail);

      const scan = await scanMods(context.value, refresh);

      const next: ReadyModsSnapshot = {
         status: 'ready',
         installId: request.installId,
         installPath: context.value.install.path,
         gameVersion: context.value.gameVersion,
         platform: context.value.platform,
         source: context.value.index.source,
         updatedAt: context.value.index.updatedAt,
         sources: context.value.index.sources,
         mods: summarizeMods(context.value.index, scan),
         external: scan.external,
         bsipaInstalled: scan.bsipaInstalled
      };
      await snapshots.set(request.installId, `${context.value.install.path}\0${context.value.platform}\0${context.value.gameVersion}`, next);

      return next;
   }

   async function previewInstall(request: ModSelectionRequest): Promise<ModInstallPreview> {
      const context = await loadContext(request.installId, false);
      if (Result.isError(context)) return invalid(request, context.error);
      if (request.modIds.length === 0) return invalid(request, { issue: 'nothing-selected' });

      const scan = await scanMods(context.value);
      const plan = buildInstallPlan(context.value.index, scan, request.modIds);
      return buildInstallPreview(request, context.value, scan, plan, request.modIds);
   }

   function buildInstallPreview(
      request: ModRequest,
      context: ModContext,
      scan: ModScan,
      plan: ReturnType<typeof buildInstallPlan>,
      selectedIds: string[]
   ): ModInstallPreview {
      if (plan.mods.length === 0) return invalid(request, { issue: 'not-found', detail: selectedIds.join(', ') });

      const warnings: ModWarning[] = [];
      if (plan.mods.some((planned) => planned.entry.isBsipa)) {
         warnings.push('bsipa-first');
         warnings.push(patcher.supported ? 'patcher-runs' : 'patcher-unsupported');
      }
      if (plan.missingDependencies) warnings.push('missing-dependency');
      if (plan.mods.some((planned) => scan.installed.has(planned.entry.modId))) warnings.push('replaces-installed');
      if (plan.mods.some((planned) => planned.entry.sourceKind === 'unofficial')) warnings.push('unofficial-source');
      if (plan.mods.some((planned) => planned.entry.sourceKind === 'unofficial' && planned.entry.claimedIdentity !== null)) {
         warnings.push('claimed-identity');
      }

      return {
         status: 'ok',
         installId: request.installId,
         installPath: context.install.path,
         pendingPath: join(context.install.path, modFolders.pending),
         downloadHosts: [...new Set(plan.mods.map((planned) => planned.entry.downloadHost))],
         mods: plan.mods.map(toPlanEntry),
         downloadBytes: plan.mods.reduce((total, planned) => total + (planned.entry.sizeBytes ?? 0), 0),
         warnings
      };
   }

   async function previewChanges(request: ModChangesRequest): Promise<ModChangesPreview> {
      const context = await loadContext(request.installId, false);
      if (Result.isError(context)) return invalid(request, context.error);
      if (request.installModIds.length === 0 || request.removeModIds.length === 0) return invalid(request, { issue: 'nothing-selected' });

      const scan = await scanMods(context.value);
      const uninstall = await buildUninstallPreview({ ...request, scope: 'selection', modIds: request.removeModIds }, context.value, scan);
      if (uninstall.status === 'invalid') return uninstall;

      const plannedScan = scanWithoutMods(scan, request.removeModIds);
      const plan = buildInstallPlan(context.value.index, plannedScan, request.installModIds);
      const install = buildInstallPreview(request, context.value, scan, plan, request.installModIds);
      if (install.status === 'invalid') return install;

      return {
         status: 'ok',
         installId: request.installId,
         install,
         uninstall,
         warnings: [...new Set([...install.warnings, ...uninstall.warnings])]
      };
   }

   async function applyChanges(request: ModChangesRequest): Promise<ModOperationResult> {
      const previewed = await previewChanges(request);
      if (previewed.status === 'invalid') return failure(request, previewed);

      const context = await loadContext(request.installId, false);
      if (Result.isError(context)) return failure(request, context.error);

      const scan = await scanMods(context.value);
      const plan = buildInstallPlan(context.value.index, scanWithoutMods(scan, request.removeModIds), request.installModIds);
      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: 'Apply mod changes',
         message: context.value.install.name,
         progress: { phase: 'preparing', current: 0, total: 2, percent: 0, unit: 'steps' },
         metadata: {
            installId: request.installId,
            install: previewed.install.mods.map((entry) => entry.name),
            remove: previewed.uninstall.mods.map((entry) => entry.name)
         },
         cancel: () => controller.abort()
      });

      void runChanges(operation.id, context.value.install, previewed, plan.mods, controller.signal);

      return { ok: true, value: operation };
   }

   async function installMods(request: ModSelectionRequest): Promise<ModOperationResult> {
      const context = await loadContext(request.installId, false);
      if (Result.isError(context)) return failure(request, context.error);

      const previewed = await previewInstall(request);
      if (previewed.status === 'invalid') return failure(request, previewed);

      const scan = await scanMods(context.value);
      const plan = buildInstallPlan(context.value.index, scan, request.modIds);
      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: `Install ${plan.mods.length} mod${plan.mods.length === 1 ? '' : 's'}`,
         message: context.value.install.name,
         progress: { phase: 'preparing', current: 0, total: plan.mods.length, percent: 0, unit: 'items' },
         metadata: { installId: request.installId, mods: previewed.mods.map((entry) => entry.name) },
         cancel: () => controller.abort()
      });

      void runInstall(operation.id, context.value.install, plan.mods, controller.signal);

      return { ok: true, value: operation };
   }

   async function runInstall(operationId: string, install: InstallDetail, planned: PlannedMod[], signal: AbortSignal) {
      try {
         const installed = await writeInstall(operationId, install, planned, signal);
         if (Result.isError(installed)) options.operations.fail(operationId, installed.error);
         else options.operations.complete(operationId, installed.value);
      } finally {
         forgetScan(install.id);
      }
   }

   async function runChanges(
      operationId: string,
      install: InstallDetail,
      previewed: ReadyModChangesPreview,
      planned: PlannedMod[],
      signal: AbortSignal
   ) {
      try {
         const uninstalled = await writeUninstall(operationId, install, previewed.uninstall, signal);
         if (Result.isError(uninstalled)) {
            options.operations.fail(operationId, uninstalled.error);
            return;
         }

         const installed = await writeInstall(operationId, install, planned, signal);
         if (Result.isError(installed)) {
            options.operations.fail(operationId, installed.error);
            return;
         }

         const outcome = {
            installId: install.id,
            installedMods: installed.value.mods,
            removedMods: uninstalled.value.mods,
            files: installed.value.files + uninstalled.value.files,
            bytes: installed.value.bytes
         };
         options.operations.complete(operationId, outcome);
      } finally {
         forgetScan(install.id);
      }
   }

   async function writeInstall(operationId: string, install: InstallDetail, planned: PlannedMod[], signal: AbortSignal) {
      let files = 0;
      let bytes = 0;

      for (const [index, mod] of planned.entries()) {
         const { entry } = mod;
         options.operations.update(operationId, {
            progress: progressFor(index, planned.length, entry.name, 0)
         });

         const installed = await installModVersion({
            ingestion: options.ingestion,
            installPath: install.path,
            entry,
            signal,
            onProgress: (progress) => {
               options.operations.update(operationId, {
                  progress: progressFor(index, planned.length, entry.name, progress.percent ?? 0)
               });
            }
         });
         if (Result.isError(installed)) return Result.err(operationError(entry.name, installed.error));

         files += installed.value.files;
         bytes += installed.value.bytes;

         if (!mod.entry.isBsipa) continue;

         if (!patcher.supported || (await patcher.isPatched(install.path))) continue;

         const patched = await patcher.patch(install.path);
         if (Result.isError(patched)) return Result.err(patched.error);
      }

      const outcome = {
         installId: install.id,
         mods: planned.length,
         files,
         bytes
      };
      return Result.ok(outcome);
   }

   async function previewUninstall(request: ModUninstallRequest): Promise<ModUninstallPreview> {
      const context = await loadContext(request.installId, false);
      if (Result.isError(context)) return invalid(request, context.error);

      const scan = await scanMods(context.value);
      return buildUninstallPreview(request, context.value, scan);
   }

   async function buildUninstallPreview(request: ModUninstallRequest, context: ModContext, scan: ModScan): Promise<ModUninstallPreview> {
      const selection = request.scope === 'all' ? [...scan.installed.keys()] : request.modIds;
      if (selection.length === 0 && request.scope === 'selection') return invalid(request, { issue: 'nothing-selected' });

      const mods = await Promise.all(selection.map((modId) => describeRemoval(context, scan, modId)));
      const removals = mods.filter((removal) => removal !== null);
      const external = request.scope === 'all' ? scan.external : [];
      const folders = request.scope === 'all' ? modRemovableFolders.map((folder) => join(context.install.path, folder)) : [];

      const warnings: ModWarning[] = [];
      if (external.length > 0) warnings.push('removes-external');
      if (removals.some((removal) => context.index.byModId.get(removal.modId)?.isBsipa) && patcher.supported) warnings.push('patcher-runs');

      return {
         status: 'ok',
         installId: request.installId,
         installPath: context.install.path,
         scope: request.scope,
         mods: removals,
         external,
         folders,
         fileCount: removals.reduce((total, removal) => total + removal.files.length, 0) + external.length,
         warnings
      };
   }

   async function uninstallMods(request: ModUninstallRequest): Promise<ModOperationResult> {
      const previewed = await previewUninstall(request);
      if (previewed.status === 'invalid') return failure(request, previewed);

      const install = await options.registry.get(request.installId);
      if (!install) return failure(request, { issue: 'not-found' });

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'delete',
         title:
            request.scope === 'all'
               ? `Remove every mod from ${install.name}`
               : `Remove ${previewed.mods.length} mod${previewed.mods.length === 1 ? '' : 's'}`,
         message: install.path,
         progress: { phase: 'preparing', current: 0, total: previewed.fileCount, percent: 0, unit: 'files' },
         metadata: { installId: request.installId, scope: request.scope },
         cancel: () => controller.abort()
      });

      void runUninstall(operation.id, install, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runUninstall(operationId: string, install: InstallDetail, previewed: ReadyModUninstallPreview, signal: AbortSignal) {
      try {
         const uninstalled = await writeUninstall(operationId, install, previewed, signal);
         if (Result.isError(uninstalled)) options.operations.fail(operationId, uninstalled.error);
         else options.operations.complete(operationId, uninstalled.value);
      } finally {
         forgetScan(install.id);
      }
   }

   async function writeUninstall(operationId: string, install: InstallDetail, previewed: ReadyModUninstallPreview, signal: AbortSignal) {
      const removesBsipa = previewed.mods.some((removal) => removal.name.trim().toLowerCase() === bsipaModName);
      if (removesBsipa && patcher.supported && (await patcher.hasPatcher(install.path))) {
         const reverted = await patcher.revert(install.path);
         if (Result.isError(reverted)) return Result.err(reverted.error);
      }

      const paths = [
         ...previewed.mods.flatMap((removal) => removal.files),
         ...previewed.external.map((external) => join(install.path, ...external.path.split('/'))),
         ...previewed.folders
      ];

      let files = 0;
      for (const [index, path] of paths.entries()) {
         const deleted = await deletePathWithProgress({
            targetPath: path,
            root: install.path,
            allowMissing: true,
            scope: 'content',
            signal
         });
         if (Result.isError(deleted)) {
            return Result.err({
               code: deleted.error.code,
               message: deleted.error.message,
               details: { path: deleted.error.path }
            });
         }

         files += deleted.value.files;
         options.operations.update(operationId, {
            progress: { phase: 'deleting', current: index + 1, total: paths.length, percent: percentOf(index + 1, paths.length), unit: 'files' }
         });
      }

      const outcome = {
         installId: install.id,
         mods: previewed.mods.length,
         files
      };
      return Result.ok(outcome);
   }

   async function previewImport(request: ModImportRequest): Promise<ModImportPreview> {
      const context = await loadContext(request.installId, false);
      if (Result.isError(context)) return invalid(request, context.error);

      const extension = extname(request.sourcePath).toLowerCase();
      if (!importExtensions.includes(extension)) return invalid(request, { issue: 'unsupported-file', detail: extension });

      const info = await readPathInfo(request.sourcePath);
      if (Result.isError(info) || info.value.kind !== 'file') return invalid(request, { issue: 'inspect-failed', detail: request.sourcePath });
      if (info.value.sizeBytes > maxModArchiveBytes) {
         return invalid(request, { issue: 'unsupported-file', detail: 'the file is larger than Encore imports' });
      }

      const name = request.sourceName ?? basename(request.sourcePath);
      const destination =
         extension === '.dll'
            ? join(context.value.install.path, modFolders.pluginsPending, name)
            : join(context.value.install.path, modFolders.pending);

      return {
         status: 'ok',
         installId: request.installId,
         sourcePath: request.sourcePath,
         kind: extension === '.dll' ? 'dll' : 'zip',
         name,
         sizeBytes: info.value.sizeBytes,
         destinationPath: destination,
         warnings: ['unverified-source']
      };
   }

   async function importMod(request: ModImportRequest, disposeSource?: () => void | Promise<void>): Promise<ModOperationResult> {
      const previewed = await previewImport(request);
      if (previewed.status === 'invalid') {
         await disposeSource?.();
         return failure(request, previewed);
      }

      const install = await options.registry.get(request.installId);
      if (!install) {
         await disposeSource?.();
         return failure(request, { issue: 'not-found' });
      }

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'import',
         title: `Import ${previewed.name}`,
         message: previewed.destinationPath,
         progress: { phase: 'preparing', current: 0, total: previewed.sizeBytes, percent: 0, unit: 'bytes' },
         metadata: { installId: request.installId, sourcePath: previewed.sourcePath },
         cancel: () => controller.abort()
      });

      void runImport(operation.id, install, previewed, controller.signal, disposeSource);

      return { ok: true, value: operation };
   }

   async function runImport(
      operationId: string,
      install: InstallDetail,
      previewed: ReadyModImportPreview,
      signal: AbortSignal,
      disposeSource?: () => void | Promise<void>
   ) {
      try {
         await writeImport(operationId, install, previewed, signal);
      } finally {
         forgetScan(install.id);
         await disposeSource?.();
      }
   }

   async function writeImport(operationId: string, install: InstallDetail, previewed: ReadyModImportPreview, signal: AbortSignal) {
      const imported =
         previewed.kind === 'zip'
            ? await importModArchive({
                 ingestion: options.ingestion,
                 installPath: install.path,
                 sourcePath: previewed.sourcePath,
                 signal,
                 onProgress: (progress) => {
                    options.operations.update(operationId, { progress });
                 }
              })
            : await importModFile(install.path, previewed, signal);

      if (Result.isError(imported)) return options.operations.fail(operationId, operationError(previewed.name, imported.error));

      const outcome = {
         installId: install.id,
         name: previewed.name,
         files: imported.value.files
      };
      options.operations.complete(operationId, outcome);
   }

   async function importModFile(installPath: string, previewed: ReadyModImportPreview, signal: AbortSignal) {
      const destination = resolveModContentPath(installPath, `${modFolders.pluginsPending}/${previewed.name}`);
      if (!destination) {
         return Result.err<{ files: number }, ContentProblem>({
            code: 'content.ingest.layout-rejected',
            message: 'the file name cannot be written into the plugins folder',
            entry: previewed.name
         });
      }

      const copied = await copyPathWithProgress({
         sourcePath: previewed.sourcePath,
         destinationPath: destination.absolutePath,
         destinationRoot: installPath,
         overwrite: true,
         scope: 'content',
         signal
      });

      return Result.isError(copied)
         ? Result.err<{ files: number }, ContentProblem>({
              code: 'content.commit.failed',
              message: 'the plugin could not be written into the install',
              path: destination.relativePath,
              detail: copied.error.code
           })
         : Result.ok<{ files: number }, ContentProblem>({ files: copied.value.files });
   }

   async function loadContext(installId: string, refresh: boolean): Promise<Result<ModContext, ModProblem>> {
      const install = await options.registry.get(installId);
      if (!install) return Result.err<ModContext, ModProblem>({ issue: 'not-found' });

      const gameVersion = install.version;
      if (!gameVersion) return Result.err<ModContext, ModProblem>({ issue: 'unknown-version' });

      const platform = modPlatformForStore(install.store);
      const request = { gameVersion, platform };
      const index = refresh ? await catalogs.refresh(request) : await catalogs.get(request);
      if (Result.isError(index)) {
         return Result.err<ModContext, ModProblem>({ issue: 'catalog-unavailable', detail: index.error.detail ?? index.error.message });
      }

      return Result.ok<ModContext, ModProblem>({
         install,
         gameVersion,
         platform,
         index: index.value
      });
   }

   async function scanMods(context: ModContext, refresh = false) {
      const cached = readRecent(scans, context.install.id);
      if (!refresh && cached && isSamePath(cached.installPath, context.install.path)) return cached.scan;

      const scan = await scanInstalledMods({ installPath: context.install.path, index: context.index, lookupHash: catalogs.lookupHash });
      setRecent(scans, context.install.id, { installPath: context.install.path, scan }, maxCachedScans);

      return scan;
   }

   function forgetScan(installId: InstallId) {
      scans.delete(installId);
      void snapshots.remove(installId);
   }

   async function describeRemoval(context: ModContext, scan: ModScan, modId: string): Promise<ModRemoval | null> {
      const installed = scan.installed.get(modId);
      const entry = context.index.byModId.get(modId);
      if (!installed || !entry) return null;

      const candidates = entry.files.flatMap((file) => modFileCandidates(context.install.path, file.path, entry.isBsipa));
      const files = await Promise.all(
         candidates.map(async (candidate) => {
            const info = await readPathInfo(candidate.absolutePath);
            return Result.isOk(info) && info.value.kind === 'file' ? candidate.absolutePath : null;
         })
      );

      return {
         modId,
         name: entry.name,
         version: installed.version,
         files: [...new Set(files.filter((file) => file !== null))]
      };
   }

   function scanWithoutMods(scan: ModScan, modIds: string[]): ModScan {
      const installed = new Map(scan.installed);
      for (const modId of modIds) installed.delete(modId);

      return { ...scan, installed };
   }

   function operationError(name: string, problem: ContentProblem): OperationError {
      return {
         code: problem.code,
         message: `${name}: ${problem.message}`,
         details: { entry: problem.entry, path: problem.path, detail: problem.detail }
      };
   }

   function invalid(request: ModRequest, problem: ModProblem) {
      return invalidModAction(request, problem.issue, problem.detail);
   }

   function failure(request: ModRequest, problem: ModProblem) {
      return modFailure(request.installId, problem.issue, problem.detail);
   }

   return {
      getMods,
      refreshMods,
      previewInstall,
      installMods,
      previewChanges,
      applyChanges,
      previewUninstall,
      uninstallMods,
      previewImport,
      importMod
   };
}
