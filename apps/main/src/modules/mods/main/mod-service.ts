import { Result } from 'better-result';

import type { ContentIngestionService } from '@/lib/content/content-ingestion';
import { createProblem, type Problem } from '@/lib/errors';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import { translate } from '@/lib/messages';
import { percentOf } from '@/lib/progress';
import type { InstallDetail, InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   bsipaModName,
   invalidModAction,
   unavailableModsSnapshot,
   type ModChangesPreview,
   type ModChangesRequest,
   type ModImportPreview,
   type ModImportRequest,
   type ModInstallPreview,
   type ModRequest,
   type ModSelectionRequest,
   type ModsSnapshot,
   type ModUninstallPreview,
   type ModUninstallRequest,
   type ReadyModUninstallPreview
} from '@/modules/mods/contract';
import type { ModCatalogService } from '@/modules/mods/main/mod-catalog';
import { createModContexts, type ModProblem } from '@/modules/mods/main/mod-context';
import { importMod as writeImportedMod, installModVersion } from '@/modules/mods/main/mod-install';
import { createModPatcher, type ModPatcher } from '@/modules/mods/main/mod-patcher';
import { progressFor, type PlannedMod } from '@/modules/mods/main/mod-plan';
import { planModChanges, planModImport, planModInstall, planModUninstall } from '@/modules/mods/main/mod-previews';
import type { ModRepositoryService } from '@/modules/mods/main/repo-service';
import type { OperationSerializable, OperationSnapshot } from '@/modules/operations/contract';
import type { CreateOperationInput, OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { join } from 'node:path';

type ModServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   ingestion: ContentIngestionService;
   dataPath: string;
   log: AppLogWriter;
   catalog: ModCatalogService;
   repositories: Pick<ModRepositoryService, 'checkDownloadHost'>;
   patcher?: ModPatcher;
};

type ModWork = (operationId: string, signal: AbortSignal) => Promise<Result<OperationSerializable, Problem>>;

export type ModService = ReturnType<typeof createModService>;

export function createModService(options: ModServiceOptions) {
   const patcher = options.patcher ?? createModPatcher();
   const contexts = createModContexts({ registry: options.registry, catalog: options.catalog, dataPath: options.dataPath, log: options.log });
   const activeInstalls = new Set<InstallId>();

   async function getMods(request: ModRequest): Promise<ModsSnapshot> {
      const cached = await contexts.cachedSnapshot(request.installId);
      if (cached) return { ...cached, installId: request.installId, source: 'cache' };

      return snapshot(request, false);
   }

   async function refreshMods(request: ModRequest): Promise<ModsSnapshot> {
      return snapshot(request, true);
   }

   async function snapshot(request: ModRequest, refresh: boolean): Promise<ModsSnapshot> {
      const next = await contexts.snapshot(request.installId, refresh);
      return Result.isOk(next) ? next.value : unavailableModsSnapshot(request, next.error.issue, next.error.detail);
   }

   function planInstall(request: ModSelectionRequest) {
      return Result.gen(async function* () {
         const context = yield* Result.await(contexts.load(request.installId));
         const plan = yield* planModInstall(request, context, patcher.supported);
         return Result.ok({ install: context.install, ...plan });
      });
   }

   function planChanges(request: ModChangesRequest, mode?: 'scan') {
      return Result.gen(async function* () {
         const context = yield* Result.await(contexts.load(request.installId, mode));
         const plan = yield* Result.await(planModChanges(request, context, patcher.supported));
         return Result.ok({ install: context.install, ...plan });
      });
   }

   function planUninstall(request: ModUninstallRequest, mode?: 'scan') {
      return Result.gen(async function* () {
         const context = yield* Result.await(contexts.load(request.installId, mode));
         const preview = yield* Result.await(planModUninstall(request, context, patcher.supported));
         return Result.ok({ install: context.install, preview });
      });
   }

   function planImport(request: ModImportRequest) {
      return Result.gen(async function* () {
         const context = yield* Result.await(contexts.load(request.installId));
         const preview = yield* Result.await(planModImport(request, context));
         return Result.ok({ install: context.install, preview });
      });
   }

   async function previewInstall(request: ModSelectionRequest): Promise<ModInstallPreview> {
      const plan = await planInstall(request);
      return Result.isOk(plan) ? plan.value.preview : invalid(request, plan.error);
   }

   async function previewChanges(request: ModChangesRequest): Promise<ModChangesPreview> {
      const plan = await planChanges(request);
      return Result.isOk(plan) ? plan.value.preview : invalid(request, plan.error);
   }

   async function previewUninstall(request: ModUninstallRequest): Promise<ModUninstallPreview> {
      const plan = await planUninstall(request);
      return Result.isOk(plan) ? plan.value.preview : invalid(request, plan.error);
   }

   async function previewImport(request: ModImportRequest): Promise<ModImportPreview> {
      const plan = await planImport(request);
      return Result.isOk(plan) ? plan.value.preview : invalid(request, plan.error);
   }

   async function installMods(request: ModSelectionRequest) {
      const plan = await planInstall(request);
      if (Result.isError(plan)) return failure(request, plan.error);

      const { install, preview, planned } = plan.value;
      return start(
         install.id,
         {
            kind: 'download',
            title: translate('mods.operations.install', { count: planned.length }),
            message: install.name,
            progress: { phase: 'preparing', current: 0, total: planned.length, percent: 0, unit: 'items' },
            metadata: { installId: request.installId, mods: preview.mods.map((entry) => entry.name) }
         },
         (operationId, signal) => writeInstall(operationId, install, planned, signal)
      );
   }

   async function applyChanges(request: ModChangesRequest) {
      const plan = await planChanges(request);
      if (Result.isError(plan)) return failure(request, plan.error);

      const { install, preview } = plan.value;
      if (preview.uninstall.warnings.includes('removes-dependants')) return Result.err(createProblem('mods.removal-changed'));
      return start(
         install.id,
         {
            kind: 'download',
            title: translate('mods.operations.apply'),
            message: install.name,
            progress: { phase: 'preparing', current: 0, total: 2, percent: 0, unit: 'steps' },
            metadata: {
               installId: request.installId,
               install: preview.install.mods.map((entry) => entry.name),
               remove: preview.uninstall.mods.map((entry) => entry.name)
            }
         },
         async (operationId, signal) => {
            const current = await planChanges(request, 'scan');
            if (Result.isError(current)) return failure(request, current.error);
            if (current.value.preview.uninstall.warnings.includes('removes-dependants')) return Result.err(createProblem('mods.removal-changed'));

            const uninstalled = await writeUninstall(operationId, current.value.install, current.value.preview.uninstall, signal);
            if (Result.isError(uninstalled)) return uninstalled;

            const installed = await writeInstall(operationId, current.value.install, current.value.planned, signal);
            if (Result.isError(installed)) return installed;

            return Result.ok({
               installId: install.id,
               installedMods: installed.value.mods,
               removedMods: uninstalled.value.mods,
               files: installed.value.files + uninstalled.value.files,
               bytes: installed.value.bytes
            });
         }
      );
   }

   async function uninstallMods(request: ModUninstallRequest) {
      const plan = await planUninstall(request);
      if (Result.isError(plan)) return failure(request, plan.error);

      const { install, preview } = plan.value;
      if (preview.warnings.includes('removes-dependants')) return Result.err(createProblem('mods.removal-changed'));
      return start(
         install.id,
         {
            kind: 'delete',
            title:
               request.scope === 'all'
                  ? translate('mods.operations.removeAll', { name: install.name })
                  : translate('mods.operations.remove', { count: preview.mods.length }),
            message: install.path,
            progress: { phase: 'preparing', current: 0, total: preview.fileCount, percent: 0, unit: 'files' },
            metadata: { installId: request.installId, scope: request.scope }
         },
         async (operationId, signal) => {
            const current = await planUninstall(request, 'scan');
            if (Result.isError(current)) return failure(request, current.error);
            if (current.value.preview.warnings.includes('removes-dependants')) return Result.err(createProblem('mods.removal-changed'));
            return writeUninstall(operationId, current.value.install, current.value.preview, signal);
         }
      );
   }

   async function importMod(request: ModImportRequest, disposeSource?: () => void | Promise<void>): Promise<Result<OperationSnapshot, Problem>> {
      const plan = await planImport(request);
      if (Result.isError(plan)) {
         await disposeSource?.();
         return failure(request, plan.error);
      }

      const { install, preview } = plan.value;
      return start(
         install.id,
         {
            kind: 'import',
            title: translate('mods.operations.import', { name: preview.name }),
            message: preview.destinationPath,
            progress: { phase: 'preparing', current: 0, total: preview.sizeBytes, percent: 0, unit: 'bytes' },
            metadata: { installId: request.installId, sourcePath: preview.sourcePath }
         },
         async (operationId, signal) => {
            const imported = await writeImportedMod({
               ingestion: options.ingestion,
               installPath: install.path,
               sourcePath: preview.sourcePath,
               kind: preview.kind,
               name: preview.name,
               signal,
               onProgress: (progress) => options.operations.update(operationId, { progress })
            });
            if (Result.isError(imported))
               return Result.err(createProblem('mods.import-failed', { name: preview.name, detail: imported.error.message }));

            return Result.ok({ installId: install.id, name: preview.name, files: imported.value.files });
         },
         disposeSource
      );
   }

   async function start(
      installId: InstallId,
      operation: Omit<CreateOperationInput, 'cancel'>,
      work: ModWork,
      cleanup?: () => void | Promise<void>
   ): Promise<Result<OperationSnapshot, Problem>> {
      if (activeInstalls.has(installId)) {
         await cleanup?.();
         return Result.err(createProblem('mods.busy'));
      }

      activeInstalls.add(installId);
      const created = options.operations.start(operation, async (operationId, signal) => {
         try {
            const result = await work(operationId, signal);
            if (Result.isError(result)) options.operations.fail(operationId, result.error);
            else options.operations.complete(operationId, result.value);
         } finally {
            contexts.forget(installId);
            activeInstalls.delete(installId);
            await cleanup?.();
         }
      });
      if (created.status === 'cancelled') {
         activeInstalls.delete(installId);
         await cleanup?.();
      }

      return Result.ok(created);
   }

   async function writeInstall(operationId: string, install: InstallDetail, planned: PlannedMod[], signal: AbortSignal) {
      let files = 0;
      let bytes = 0;
      const failed: { name: string; detail: string }[] = [];

      for (const [index, { entry }] of planned.entries()) {
         options.operations.update(operationId, { progress: progressFor(index, planned.length, entry.name, 0) });

         const permitted = await options.repositories.checkDownloadHost(entry.downloadHost);
         if (Result.isError(permitted)) {
            return Result.err<InstallOutcome, Problem>(createProblem('mods.install-failed', { name: entry.name, detail: permitted.error.message }));
         }

         const installed = await installModVersion({
            ingestion: options.ingestion,
            installPath: install.path,
            entry,
            signal,
            onProgress: (progress) => {
               options.operations.update(operationId, { progress: progressFor(index, planned.length, entry.name, progress.percent ?? 0) });
            }
         });
         if (Result.isError(installed)) {
            if (entry.isBsipa || signal.aborted) {
               return Result.err<InstallOutcome, Problem>(
                  createProblem('mods.install-failed', { name: entry.name, detail: installed.error.message })
               );
            }
            failed.push({ name: entry.name, detail: installed.error.message });
            continue;
         }

         files += installed.value.files;
         bytes += installed.value.bytes;

         if (!entry.isBsipa || !(await patcher.canPatch()) || (await patcher.isPatched(install.path))) continue;

         const patched = await patcher.patch(install.path);
         if (Result.isError(patched)) return Result.err<InstallOutcome, Problem>(patched.error);
      }

      const [firstFailure] = failed;
      if (firstFailure) {
         return Result.err<InstallOutcome, Problem>(
            createProblem('mods.install-failed', { name: failed.map(({ name }) => name).join(', '), detail: firstFailure.detail })
         );
      }

      return Result.ok<InstallOutcome, Problem>({ installId: install.id, mods: planned.length, files, bytes });
   }

   async function writeUninstall(
      operationId: string,
      install: InstallDetail,
      preview: ReadyModUninstallPreview,
      signal: AbortSignal
   ): Promise<Result<UninstallOutcome, Problem>> {
      const bsipaIndex = preview.mods.findIndex((removal) => removal.name.trim().toLowerCase() === bsipaModName);
      const removalGroups = [
         ...preview.mods.map((removal) => removal.files),
         [...preview.external.map((external) => join(install.path, ...external.path.split('/'))), ...preview.folders]
      ];
      const total = removalGroups.reduce((sum, paths) => sum + paths.length, 0);

      let files = 0;
      let current = 0;
      for (const [index, paths] of removalGroups.entries()) {
         if (signal.aborted) return Result.err(createProblem('filesystem.operation.cancelled'));
         if (index === bsipaIndex && (await patcher.canPatch()) && (await patcher.hasPatcher(install.path))) {
            const reverted = await patcher.revert(install.path);
            if (Result.isError(reverted)) return Result.err(reverted.error);
         }

         for (const path of paths) {
            const deleted = await deletePathWithProgress({ targetPath: path, root: install.path, allowMissing: true, signal });
            if (Result.isError(deleted)) return Result.err(deleted.error);

            files += deleted.value.files;
            current += 1;
            options.operations.update(operationId, {
               progress: { phase: 'deleting', current, total, percent: percentOf(current, total), unit: 'files' }
            });
         }
      }

      if (signal.aborted) return Result.err(createProblem('filesystem.operation.cancelled'));
      return Result.ok({ installId: install.id, mods: preview.mods.length, files });
   }

   function invalid(request: ModRequest, problem: ModProblem) {
      return invalidModAction(request, problem.issue, problem.detail);
   }

   function failure(request: ModRequest, problem: ModProblem) {
      return Result.err(createProblem(`mods.${problem.issue}`, { installId: request.installId, detail: problem.detail }));
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

type UninstallOutcome = { installId: InstallId; mods: number; files: number };
type InstallOutcome = UninstallOutcome & { bytes: number };
