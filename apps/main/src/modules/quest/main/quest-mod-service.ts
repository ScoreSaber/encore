import { Result } from 'better-result';

import { setRecent } from '@/lib/content/content-cache';
import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import {
   invalidModAction,
   unavailableModsSnapshot,
   type ModChangesPreview,
   type ModChangesRequest,
   type ModImportPreview,
   type ModImportRequest,
   type ModInstallPreview,
   type ModRepositorySyncRequest,
   type ModRepositorySyncResult,
   type ModRequest,
   type ModSelectionRequest,
   type ModsSnapshot,
   type ModUninstallPreview,
   type ModUninstallRequest,
   type ModWarning,
   type ReadyModChangesPreview,
   type ReadyModUninstallPreview
} from '@/modules/mods/contract';
import type { ModProblem } from '@/modules/mods/main/mod-context';
import { buildModIndex } from '@/modules/mods/main/mod-index';
import { modContentLimits } from '@/modules/mods/main/mod-install';
import { buildInstallPlan, describeInstallPlan, summarizeMods } from '@/modules/mods/main/mod-plan';
import { withoutInstalledMods, type ModScan } from '@/modules/mods/main/mod-scan';
import type { ModRepositoryService } from '@/modules/mods/main/repo-service';
import type { OperationSerializable, OperationSnapshot } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { questInstallId } from '@/modules/quest/contract';
import { openQmod } from '@/modules/quest/main/qmod';
import type { QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestModCatalog, type QuestModCatalog } from '@/modules/quest/main/quest-mod-catalog';
import {
   defaultQuestDownload,
   localQmod,
   prepareInstall,
   toQueuedQmod,
   validateQmod,
   withStaging,
   writeInstall,
   writeUninstall,
   type QuestContext,
   type QuestDownload,
   type QuestModJob,
   type QueuedQmod
} from '@/modules/quest/main/quest-mod-install';
import { describeScan, installedRecords, readQuestMods, recordModId, type QuestScan } from '@/modules/quest/main/quest-mod-records';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import {
   questEarlyModsDir,
   questLateModsDir,
   questLibsDir,
   questModDataDir,
   questModloaderDir,
   questPackagePath
} from '@/modules/quest/main/quest-paths';
import type { TargetId, TargetRequest } from '@/modules/targets/contract';

import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

type QuestModRequest = TargetRequest<ModRequest>;
type QuestModSelectionRequest = TargetRequest<ModSelectionRequest>;
type QuestModChangesRequest = TargetRequest<ModChangesRequest>;
type QuestModUninstallRequest = TargetRequest<ModUninstallRequest>;
type QuestModImportRequest = TargetRequest<ModImportRequest>;

export type QuestModService = ReturnType<typeof createQuestModService>;

export function createQuestModService(options: {
   devices: QuestDeviceService;
   operations: OperationRegistry;
   repositories: Pick<ModRepositoryService, 'sync' | 'refresh' | 'checkDownloadHost' | 'listEntries' | 'isQuestModsEnabled'>;
   mutations: QuestMutationLock;
   catalog?: QuestModCatalog;
   download?: QuestDownload;
   stagingRoot?: string;
}) {
   const catalog = options.catalog ?? createQuestModCatalog({ repositories: options.repositories });
   const download = options.download ?? defaultQuestDownload;
   const scans = new Map<TargetId, QuestScan>();
   const targetGenerations = new Map<TargetId, number>();
   const deviceSignatures = new Map<TargetId, string>();
   let globalGeneration = 0;

   function generationFor(targetId: TargetId) {
      return `${globalGeneration}:${targetGenerations.get(targetId) ?? 0}`;
   }

   function forgetScan(targetId?: TargetId) {
      if (targetId) {
         targetGenerations.set(targetId, (targetGenerations.get(targetId) ?? 0) + 1);
         scans.delete(targetId);
      } else {
         globalGeneration += 1;
         scans.clear();
      }
   }

   const unsubscribeDevices = options.devices.subscribe((event) => {
      const targetId = event.type === 'target-updated' ? event.target.id : event.targetId;
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) {
         if (deviceSignatures.delete(targetId)) forgetScan(targetId);
         return;
      }
      const signature = `${connection.value.gameVersion ?? ''}\0${connection.value.modloaderInstalled}`;
      if (deviceSignatures.get(targetId) !== signature) {
         deviceSignatures.set(targetId, signature);
         forgetScan(targetId);
      }
   });

   async function syncRepositories(request: TargetRequest<ModRepositorySyncRequest>): Promise<ModRepositorySyncResult> {
      forgetScan();
      return options.repositories.sync(request);
   }

   async function installCoreMods(request: QuestModRequest & { operationId: string; signal: AbortSignal }) {
      await options.devices.refresh();
      forgetScan(request.targetId);
      const context = await loadContext(request, true, { requiredCore: true });
      if (Result.isError(context)) return Result.err(createProblem('quest.install.core-mods-unavailable', { cause: context.error.detail }));
      const core = context.value.index.entries.filter((entry) => entry.category === 'core');
      if (core.length === 0) return Result.err(createProblem('quest.install.no-core-mods'));

      return withStaging(options.stagingRoot, (staging) =>
         install(job(context.value, request.operationId, staging, request.signal), core.map(toQueuedQmod))
      );
   }

   async function getMods(request: QuestModRequest): Promise<ModsSnapshot> {
      return snapshot(request, false);
   }

   async function refreshMods(request: QuestModRequest): Promise<ModsSnapshot> {
      return snapshot(request, true);
   }

   async function snapshot(request: QuestModRequest, refresh: boolean): Promise<ModsSnapshot> {
      if (refresh) {
         await options.devices.refresh();
         await options.repositories.refresh();
      }

      const loaded = await loadScan(request, refresh);
      if (Result.isError(loaded)) return unavailableModsSnapshot(request, loaded.error.issue, loaded.error.detail);
      const { context, scan } = loaded.value;

      return {
         status: 'ready',
         installId: request.installId,
         installPath: questModDataDir,
         gameVersion: context.gameVersion,
         platform: 'quest',
         source: context.index.source,
         updatedAt: context.index.updatedAt,
         sources: context.index.sources,
         mods: [...summarizeMods(context.index, scan), ...scan.libraries],
         external: scan.external,
         bsipaInstalled: context.connection.modloaderInstalled
      };
   }

   async function previewInstall(request: QuestModSelectionRequest): Promise<ModInstallPreview> {
      const loaded = await loadScan(request);
      if (Result.isError(loaded)) return invalid(request, loaded.error);
      if (request.modIds.length === 0) return invalid(request, { issue: 'nothing-selected' });

      return buildInstallPreview(request, loaded.value.context, loaded.value.scan, request.modIds);
   }

   function buildInstallPreview(
      request: QuestModRequest,
      context: QuestContext,
      scan: ModScan,
      modIds: string[],
      removeModIds: string[] = []
   ): ModInstallPreview {
      const plan = buildInstallPlan(context.index, withoutInstalledMods(scan, removeModIds), modIds);
      if (plan.mods.length === 0) return invalid(request, { issue: 'not-found', detail: modIds.join(', ') });

      return {
         status: 'ok',
         installId: request.installId,
         installPath: questModDataDir,
         pendingPath: questModloaderDir,
         ...describeInstallPlan({ ...plan, missingDependencies: false }, scan, false)
      };
   }

   async function previewChanges(request: QuestModChangesRequest): Promise<ModChangesPreview> {
      const loaded = await loadScan(request);
      if (Result.isError(loaded)) return invalid(request, loaded.error);
      return buildChangesPreview(request, loaded.value.context, loaded.value.scan);
   }

   function buildChangesPreview(request: QuestModChangesRequest, context: QuestContext, scan: QuestScan): ModChangesPreview {
      if (request.installModIds.length === 0 || request.removeModIds.length === 0) {
         return invalid(request, { issue: 'nothing-selected' });
      }

      const uninstall = buildUninstallPreview({ ...request, scope: 'selection', modIds: request.removeModIds, externalIds: [] }, scan);
      if (uninstall.status === 'invalid') return uninstall;

      const install = buildInstallPreview(request, context, scan, request.installModIds, request.removeModIds);
      if (install.status === 'invalid') return install;

      return {
         status: 'ok',
         installId: request.installId,
         install,
         uninstall,
         warnings: [...new Set([...install.warnings, ...uninstall.warnings])]
      };
   }

   async function applyChanges(request: QuestModChangesRequest): Promise<Result<OperationSnapshot, Problem>> {
      const loaded = await loadScan(request);
      if (Result.isError(loaded)) return failure(request, loaded.error);
      const { context, scan } = loaded.value;
      const previewed = buildChangesPreview(request, context, scan);
      if (previewed.status === 'invalid') return failure(request, previewed);

      const plan = buildInstallPlan(context.index, withoutInstalledMods(scan, request.removeModIds), request.installModIds);
      const queue = plan.mods.map((planned) => toQueuedQmod(planned.entry));
      const lock = options.mutations.acquire(request.targetId);
      if (Result.isError(lock)) return Result.err(lock.error);
      const operation = options.operations.start(
         {
            kind: 'download',
            title: translate('quest.operations.applyChanges'),
            message: translate('quest.operations.game'),
            targetId: request.targetId,
            progress: { phase: 'preparing', current: 0, total: 2, percent: 0, unit: 'steps' },
            metadata: {
               installId: request.installId,
               install: previewed.install.mods.map((entry) => entry.name),
               remove: previewed.uninstall.mods.map((entry) => entry.name)
            }
         },
         (operationId, signal) =>
            withStaging(options.stagingRoot, (staging) => applyStaged(job(context, operationId, staging, signal), previewed, queue)).then((result) =>
               settle(operationId, signal, result)
            ),
         lock.value
      );

      return Result.ok(operation);
   }

   async function installMods(request: QuestModSelectionRequest): Promise<Result<OperationSnapshot, Problem>> {
      const loaded = await loadScan(request);
      if (Result.isError(loaded)) return failure(request, loaded.error);
      const { context, scan } = loaded.value;
      if (request.modIds.length === 0) return failure(request, { issue: 'nothing-selected' });
      const previewed = buildInstallPreview(request, context, scan, request.modIds);
      if (previewed.status === 'invalid') return failure(request, previewed);

      const plan = buildInstallPlan(context.index, scan, request.modIds);
      const queue = plan.mods.map((planned) => toQueuedQmod(planned.entry));
      const lock = options.mutations.acquire(request.targetId);
      if (Result.isError(lock)) return Result.err(lock.error);
      const operation = options.operations.start(
         {
            kind: 'download',
            title: translate('quest.operations.install', { count: plan.mods.length }),
            message: translate('quest.operations.game'),
            targetId: request.targetId,
            progress: { phase: 'preparing', current: 0, total: plan.mods.length, percent: 0, unit: 'items' },
            metadata: { installId: request.installId, mods: previewed.mods.map((entry) => entry.name) }
         },
         (operationId, signal) =>
            withStaging(options.stagingRoot, (staging) => install(job(context, operationId, staging, signal), queue)).then((result) =>
               settle(operationId, signal, result)
            ),
         lock.value
      );

      return Result.ok(operation);
   }

   async function install(job: QuestModJob, queue: QueuedQmod[]) {
      const installed = await Result.gen(async function* () {
         const scan = yield* Result.await(scanMods(job.context, false));
         const prepared = yield* Result.await(prepareInstall(job, queue, installedRecords(scan)));
         return writeInstall(job, prepared, scan.records);
      });
      forgetScan(job.context.targetId);
      return installed;
   }

   function applyStaged(job: QuestModJob, previewed: ReadyModChangesPreview, queue: QueuedQmod[]) {
      const removedIds = new Set(previewed.uninstall.mods.map((mod) => mod.modId));

      return Result.gen(async function* () {
         const scan = yield* Result.await(scanMods(job.context, false));
         const removedRecords = scan.records.filter((record) => removedIds.has(recordModId(record, scan)));
         const remaining = scan.records.filter((record) => !removedIds.has(recordModId(record, scan)));
         const prepared = yield* Result.await(
            prepareInstall(
               job,
               queue,
               remaining.filter((record) => !scan.missing.has(record.id))
            )
         );
         if (job.signal.aborted) return Result.err(createProblem('quest.install.cancelled'));

         options.operations.update(job.operationId, { cancelable: false });
         const uninstalled = await writeUninstall({ ...job, signal: new AbortController().signal }, previewed.uninstall, removedRecords, remaining);
         forgetScan(job.context.targetId);
         const removed = yield* uninstalled;
         const { records } = yield* Result.await(scanMods(job.context, false));
         const installed = await writeInstall({ ...job, signal: new AbortController().signal }, prepared, records);
         forgetScan(job.context.targetId);
         const added = yield* installed;

         return Result.ok({
            installId: questInstallId,
            installedMods: added.mods,
            removedMods: removed.mods,
            files: added.files + removed.files,
            bytes: added.bytes
         });
      });
   }

   async function previewUninstall(request: QuestModUninstallRequest): Promise<ModUninstallPreview> {
      const loaded = await loadScan(request);
      if (Result.isError(loaded)) return invalid(request, loaded.error);
      return buildUninstallPreview(request, loaded.value.scan);
   }

   function buildUninstallPreview(request: QuestModUninstallRequest, scan: QuestScan): ModUninstallPreview {
      const externalIds = new Set(request.externalIds);
      const selected =
         request.scope === 'all'
            ? scan.records
            : scan.records.filter((record) => request.modIds.includes(recordModId(record, scan)) || externalIds.has(`record:${record.id}`));
      const external =
         request.scope === 'all' ? scan.external : scan.external.filter((file) => externalIds.has(file.id) && !file.id.startsWith('record:'));
      if (selected.length === 0 && external.length === 0 && request.scope === 'selection') return invalid(request, { issue: 'nothing-selected' });

      const folders = request.scope === 'all' ? [questEarlyModsDir, questLateModsDir, questLibsDir] : [];

      const warnings: ModWarning[] = [];
      if (external.length > 0 && request.scope === 'all') warnings.push('removes-external');

      return {
         status: 'ok',
         installId: request.installId,
         installPath: questModDataDir,
         scope: request.scope,
         mods: selected.map((record) => ({
            modId: recordModId(record, scan),
            name: record.name,
            version: record.version,
            files: [...record.files, record.packagePath]
         })),
         external,
         folders,
         fileCount: selected.reduce((total, record) => total + record.files.length + 1, 0) + external.length,
         warnings
      };
   }

   async function uninstallMods(request: QuestModUninstallRequest): Promise<Result<OperationSnapshot, Problem>> {
      const loaded = await loadScan(request);
      if (Result.isError(loaded)) return failure(request, loaded.error);
      const { context, scan } = loaded.value;
      const previewed = buildUninstallPreview(request, scan);
      if (previewed.status === 'invalid') return failure(request, previewed);

      const lock = options.mutations.acquire(request.targetId);
      if (Result.isError(lock)) return Result.err(lock.error);
      const operation = options.operations.start(
         {
            kind: 'delete',
            title:
               request.scope === 'all'
                  ? translate('quest.operations.removeAll')
                  : translate('quest.operations.remove', { count: previewed.mods.length }),
            message: translate('quest.operations.game'),
            targetId: request.targetId,
            progress: { phase: 'preparing', current: 0, total: previewed.fileCount, percent: 0, unit: 'files' },
            metadata: { installId: request.installId, scope: request.scope }
         },
         (operationId, signal) =>
            withStaging(options.stagingRoot, (staging) => uninstall(job(context, operationId, staging, signal), previewed)).then((result) =>
               settle(operationId, signal, result)
            ),
         lock.value
      );

      return Result.ok(operation);
   }

   async function uninstall(job: QuestModJob, previewed: ReadyModUninstallPreview) {
      const removedIds = new Set(previewed.mods.map((removal) => removal.modId));
      const uninstalled = await Result.gen(async function* () {
         const scan = yield* Result.await(scanMods(job.context, false));
         const removed = scan.records.filter((record) => removedIds.has(recordModId(record, scan)));
         const remaining = scan.records.filter((record) => !removedIds.has(recordModId(record, scan)));
         return writeUninstall(job, previewed, removed, remaining);
      });
      forgetScan(job.context.targetId);
      return uninstalled;
   }

   async function previewImport(request: QuestModImportRequest): Promise<ModImportPreview> {
      const context = await loadContext(request, false, { allowMissingCatalog: true });
      if (Result.isError(context)) return invalid(request, context.error);
      return inspectImport(request, context.value);
   }

   async function inspectImport(request: QuestModImportRequest, context: QuestContext): Promise<ModImportPreview> {
      const extension = extname(request.sourcePath).toLowerCase();
      if (extension !== '.qmod') return invalid(request, { issue: 'unsupported-file', detail: extension });

      const info = await Result.tryPromise(() => stat(request.sourcePath));
      if (Result.isError(info) || !info.value.isFile()) return invalid(request, { issue: 'inspect-failed', detail: request.sourcePath });
      if (info.value.size > modContentLimits.maxArchiveBytes) {
         return invalid(request, { issue: 'unsupported-file', detail: translate('quest.operations.importTooLarge') });
      }

      const opened = await openQmod(request.sourcePath);
      if (Result.isError(opened)) return invalid(request, { issue: 'unsupported-file', detail: opened.error.message });

      const manifest = opened.value.manifest;
      opened.value.close();
      const compatible = validateQmod(context.gameVersion, localQmod(request.sourcePath, manifest.name), manifest);
      if (Result.isError(compatible)) return invalid(request, { issue: 'unsupported-file', detail: compatible.error.message });

      return {
         status: 'ok',
         installId: request.installId,
         sourcePath: request.sourcePath,
         kind: 'qmod',
         name: manifest.name,
         sizeBytes: info.value.size,
         destinationPath: questPackagePath(manifest.id),
         warnings: ['unverified-source']
      };
   }

   async function importMod(request: QuestModImportRequest, disposeSource?: () => void | Promise<void>): Promise<Result<OperationSnapshot, Problem>> {
      const dispose = () => Result.tryPromise(async () => disposeSource?.());

      const context = await loadContext(request, false, { allowMissingCatalog: true });
      if (Result.isError(context)) {
         await dispose();
         return failure(request, context.error);
      }

      const previewed = await inspectImport(request, context.value);
      if (previewed.status === 'invalid') {
         await dispose();
         return failure(request, previewed);
      }

      const lock = options.mutations.acquire(request.targetId);
      if (Result.isError(lock)) {
         await dispose();
         return Result.err(lock.error);
      }
      const queue = [localQmod(previewed.sourcePath, previewed.name)];
      const operation = options.operations.start(
         {
            kind: 'import',
            title: translate('quest.operations.import', { name: previewed.name }),
            message: previewed.destinationPath,
            targetId: request.targetId,
            progress: { phase: 'preparing', current: 0, total: 1, percent: 0, unit: 'items' },
            metadata: { installId: request.installId, sourcePath: previewed.sourcePath }
         },
         (operationId, signal) =>
            withStaging(options.stagingRoot, (staging) => install(job(context.value, operationId, staging, signal), queue)).then(async (result) => {
               await dispose();
               settle(operationId, signal, result);
            }),
         lock.value
      );

      return Result.ok(operation);
   }

   function job(context: QuestContext, operationId: string, staging: string, signal: AbortSignal): QuestModJob {
      return { context, operations: options.operations, operationId, staging, signal, download, repositories: options.repositories };
   }

   function settle(operationId: string, signal: AbortSignal, result: Result<OperationSerializable, Problem>) {
      if (signal.aborted) return;
      if (Result.isError(result)) options.operations.fail(operationId, result.error);
      else options.operations.complete(operationId, result.value);
   }

   async function loadContext(
      request: QuestModRequest,
      refresh: boolean,
      input: { requiredCore?: boolean; allowMissingCatalog?: boolean } = {}
   ): Promise<Result<QuestContext, ModProblem>> {
      if (request.installId !== questInstallId) return Result.err({ issue: 'not-found' });

      const connection = options.devices.getConnection(request.targetId);
      if (Result.isError(connection)) return Result.err({ issue: 'inspect-failed', detail: connection.error.message });

      const gameVersion = connection.value.gameVersion;
      if (!gameVersion) return Result.err({ issue: 'unknown-version' });

      const index = refresh ? await catalog.refresh(gameVersion, { requiredCore: input.requiredCore }) : await catalog.get(gameVersion);
      if (Result.isOk(index)) return Result.ok({ targetId: request.targetId, connection: connection.value, gameVersion, index: index.value });
      if (!input.allowMissingCatalog) return Result.err({ issue: 'catalog-unavailable', detail: index.error.message });

      return Result.ok({
         targetId: request.targetId,
         connection: connection.value,
         gameVersion,
         index: buildModIndex({ gameVersion, platform: 'quest', source: 'cache', updatedAt: new Date().toISOString(), sources: [], entries: [] })
      });
   }

   async function scanMods(context: QuestContext, refresh: boolean): Promise<Result<QuestScan, Problem>> {
      const { index, connection } = context;
      const cached = scans.get(context.targetId);
      if (!refresh && cached) {
         const external = cached.external.filter((entry) => !entry.id.startsWith('record:'));
         return Result.ok(describeScan(index, connection.modloaderInstalled, cached.records, cached.missing, external));
      }

      const generation = generationFor(context.targetId);
      const read = await readQuestMods(connection, context.gameVersion);
      return read.map(({ records, missing, external }) => {
         const scan = describeScan(index, connection.modloaderInstalled, records, missing, external);
         if (generation === generationFor(context.targetId)) setRecent(scans, context.targetId, scan, 4);
         return scan;
      });
   }

   async function loadScan(request: QuestModRequest, refresh = false): Promise<Result<{ context: QuestContext; scan: QuestScan }, ModProblem>> {
      const context = await loadContext(request, refresh);
      if (Result.isError(context)) return Result.err(context.error);
      const scan = await scanMods(context.value, refresh);
      if (Result.isError(scan)) return Result.err({ issue: 'inspect-failed', detail: scan.error.message });
      return Result.ok({ context: context.value, scan: scan.value });
   }

   function invalid(request: QuestModRequest, problem: ModProblem) {
      return invalidModAction(request, problem.issue, problem.detail);
   }

   function failure(request: QuestModRequest, problem: ModProblem) {
      return Result.err(createProblem(`quest.mods.${problem.issue}`, { installId: request.installId, detail: problem.detail }));
   }

   function dispose() {
      unsubscribeDevices();
      scans.clear();
      targetGenerations.clear();
      deviceSignatures.clear();
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
      importMod,
      syncRepositories,
      installCoreMods,
      forgetScan,
      dispose
   };
}
