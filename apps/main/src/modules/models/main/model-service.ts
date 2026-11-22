import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcFailureResult } from '@/ipc/core';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import type { ContentStaging } from '@/lib/content/content-staging';
import { deleteManagedEntries, ensureContentFolder, isManagedPath, resolveManagedEntries } from '@/lib/content/managed-selection';
import { createScanStates, pruneScanCache, type ScanRequest } from '@/lib/content/scan-states';
import { createProblem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   createEmptyModelCollectionSnapshot,
   invalidModelAction,
   isCatalogModelType,
   localModelSummarySchema,
   modelCollectionSnapshotSchema,
   type LocalModelSummary,
   type ModelActionIssue,
   type ModelCollectionSnapshot,
   type ModelDeletePreview,
   type ModelDetailRequest,
   type ModelDownloadRequest,
   type ModelExportRequest,
   type ModelImportRequest,
   type ModelOperationResult,
   type ModelSearchRequest,
   type ModelSearchResult,
   type ModelSelectionRequest
} from '@/modules/models/contract';
import { createBeatModsAssetCatalog, modelDownloadHosts } from '@/modules/models/main/beatmods-assets';
import { exportModelsToZip } from '@/modules/models/main/model-archive';
import { createModelIndex } from '@/modules/models/main/model-index';
import {
   installModelFiles,
   modelContentLimits,
   modelKey,
   type InstallModelFilesInput,
   type ModelFileSource
} from '@/modules/models/main/model-install';
import { modelFolderPath, modelTypeForFileName, toSafeModelFileName } from '@/modules/models/main/model-paths';
import { scanModelFolders, type ModelScanCacheEntry } from '@/modules/models/main/model-scanner';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress, createInstallProgress } from '@/modules/operations/main/operation-reporting';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { basename } from 'node:path';

function failure(installId: InstallId, issue: ModelActionIssue, detail?: string): IpcFailureResult {
   return { ok: false, error: createProblem(`models.${issue}`, { installId, detail }) };
}

const modelScanCacheEntrySchema = z.object({
   fingerprint: z.string(),
   model: localModelSummarySchema
});

type ModelServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   dataPath: string;
   log: AppLogWriter;
   staging?: ContentStaging;
};

export type ModelService = ReturnType<typeof createModelService>;

type ReadyDeletePreview = Extract<ModelDeletePreview, { status: 'ok' }>;

type ResolvedSelection = { status: 'invalid'; issue: ModelActionIssue } | { status: 'ok'; models: LocalModelSummary[] };

export function createModelService(options: ModelServiceOptions) {
   const ingestion = createContentIngestionService({
      dataPath: options.dataPath,
      limits: modelContentLimits,
      staging: options.staging
   });
   const catalog = createBeatModsAssetCatalog();
   const modelIndex = createModelIndex({ dataPath: options.dataPath });
   const reportInstallProgress = createInstallProgress(options.operations);
   const reportBytesProgress = createBytesProgress(options.operations);
   const states = createScanStates({
      dataPath: options.dataPath,
      log: options.log,
      cacheName: 'models',
      snapshotSchema: modelCollectionSnapshotSchema,
      cacheEntrySchema: modelScanCacheEntrySchema,
      extraSchema: z.null(),
      emptyExtra: null,
      getInstallPath: async (installId) => (await options.registry.get(installId))?.path ?? null,
      emptySnapshot: (installId, status) => createEmptyModelCollectionSnapshot({ installId }, status),
      runScan
   });
   const { list, rescan } = states;

   async function runScan({ installId, installPath, state, onProgress }: ScanRequest<ModelCollectionSnapshot, ModelScanCacheEntry, null>) {
      const scanned = await scanModelFolders({
         installPath,
         cache: state.cache,
         onProgress
      });

      pruneScanCache(state.cache, new Set(scanned.models.map((model) => model.id)));

      state.snapshot = {
         installId,
         status: scanned.status,
         installPath,
         folders: scanned.folders,
         models: await describeModels(scanned.models),
         problems: scanned.problems,
         progress: null,
         scannedAt: new Date().toISOString()
      };

      return state.snapshot;
   }

   async function describeModels(models: LocalModelSummary[]) {
      const described: LocalModelSummary[] = [];

      for (const model of models) {
         const known = model.hash ? await modelIndex.describe(model.hash) : null;
         described.push(
            known
               ? {
                    ...model,
                    name: known.name || model.name,
                    author: known.author || null,
                    source: 'modelsaber',
                    thumbnailUrl: known.thumbnailUrl
                 }
               : model
         );
      }

      return described;
   }

   async function getModelPath(request: ModelDetailRequest) {
      const snapshot = await list({ installId: request.installId });
      const model = snapshot.models.find((entry) => entry.id === request.modelId);
      if (!model || !snapshot.installPath) return null;

      return (await isManagedPath(modelFolderPath(snapshot.installPath, model.type), model.path)) ? model.path : null;
   }

   async function previewDelete(request: ModelSelectionRequest): Promise<ModelDeletePreview> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return invalidModelAction(request, selected.issue);

      const folders = [...new Set(selected.models.map((model) => model.type))].sort();

      return {
         status: 'ok',
         installId: request.installId,
         names: selected.models.map((model) => model.name || model.fileName),
         modelCount: selected.models.length,
         sizeBytes: selected.models.reduce((total, model) => total + model.sizeBytes, 0),
         folders
      };
   }

   async function startDelete(request: ModelSelectionRequest): Promise<ModelOperationResult> {
      const previewed = await previewDelete(request);
      if (previewed.status === 'invalid') return failure(request.installId, previewed.issue, previewed.detail);

      const operation = options.operations.start(
         {
            kind: 'delete',
            title: translate('models.actions.delete.action', { count: previewed.modelCount }),
            message: previewed.names.slice(0, 3).join(', '),
            progress: {
               phase: 'preparing',
               current: 0,
               total: previewed.sizeBytes,
               percent: 0,
               unit: 'bytes'
            },
            metadata: {
               installId: request.installId,
               modelCount: previewed.modelCount
            }
         },
         (operationId, signal) => runDelete(operationId, request, previewed, signal)
      );

      return { ok: true, value: operation };
   }

   async function runDelete(operationId: string, request: ModelSelectionRequest, previewed: ReadyDeletePreview, signal: AbortSignal) {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') {
         return options.operations.fail(operationId, createProblem(`models.${selected.issue}`));
      }

      const install = await options.registry.get(request.installId);
      if (!install) {
         return options.operations.fail(operationId, createProblem('models.install-not-found'));
      }

      const deleted = await deleteManagedEntries(
         selected.models.map((model) => ({
            path: model.path,
            root: modelFolderPath(install.path, model.type),
            label: model.name || model.fileName
         })),
         { signal, onProgress: ({ bytes, label }) => reportBytesProgress(operationId, 'deleting', bytes, previewed.sizeBytes, label) }
      );
      await rescan({ installId: request.installId });
      if (Result.isError(deleted)) return options.operations.fail(operationId, deleted.error);

      options.operations.complete(operationId, {
         installId: request.installId,
         modelCount: selected.models.length,
         bytes: deleted.value.bytes,
         files: deleted.value.files
      });
   }

   async function search(request: ModelSearchRequest): Promise<ModelSearchResult> {
      if (!isCatalogModelType(request.type))
         return {
            status: 'failed',
            issue: 'unsupported-type',
            detail: request.type
         };

      const page = request.page ?? 0;
      const found = await catalog.search({
         type: request.type,
         query: request.query,
         page
      });
      if (Result.isError(found)) {
         const result: ModelSearchResult = { status: 'failed', issue: found.error.issue };
         if (found.error.detail) result.detail = found.error.detail;
         return result;
      }

      const installed = await installedKeys(request.installId);
      for (const model of found.value.models) {
         await modelIndex.remember(model);
      }
      await modelIndex.flush();

      return {
         status: 'ok',
         type: request.type,
         query: request.query,
         page,
         hasMore: found.value.hasMore,
         models: found.value.models.map((model) => ({
            ...model,
            installed: installed.has(modelKey(model.type, model.hash))
         }))
      };
   }

   async function lookup(id: string) {
      const record = await catalog.getById(id);
      if (Result.isError(record)) return null;

      await modelIndex.remember(record.value.summary);
      await modelIndex.flush();

      return record.value.summary;
   }

   async function startDownload(request: ModelDownloadRequest): Promise<ModelOperationResult> {
      const record = await catalog.getById(request.source.id);
      if (Result.isError(record)) return failure(request.installId, 'source-unavailable', record.error.detail);

      const summary = record.value.summary;
      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'install-not-found');

      const installed = await installedKeys(request.installId);
      if (installed.has(modelKey(summary.type, summary.hash))) return failure(request.installId, 'already-installed', summary.name);

      const folder = await ensureContentFolder(modelFolderPath(install.path, summary.type));
      if (!folder) return failure(request.installId, 'inspect-failed', summary.type);

      await modelIndex.remember(summary);
      await modelIndex.flush();

      const operation = options.operations.start(
         {
            kind: 'download',
            title: translate('models.operations.download', { name: summary.name }),
            message: summary.author,
            progress: {
               phase: 'preparing',
               current: 0,
               total: 1,
               percent: 0,
               unit: 'items'
            },
            metadata: {
               installId: request.installId,
               modelId: summary.id,
               type: summary.type
            }
         },
         (operationId, signal) =>
            runInstall(operationId, {
               installId: request.installId,
               installPath: install.path,
               sources: [
                  {
                     source: { kind: 'url', url: record.value.downloadUrl },
                     type: summary.type,
                     fileName: toSafeModelFileName(summary.name, summary.type, summary.id),
                     expectedHash: summary.hash
                  }
               ],
               allowedHosts: modelDownloadHosts,
               installed,
               signal
            })
      );

      return { ok: true, value: operation };
   }

   async function startImport(request: ModelImportRequest): Promise<ModelOperationResult> {
      if (request.paths.length === 0) return failure(request.installId, 'no-source');

      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'install-not-found');

      const sources: ModelFileSource[] = request.paths.flatMap((path) => {
         const type = modelTypeForFileName(path);
         return type
            ? [
                 {
                    source: { kind: 'file', path },
                    type,
                    fileName: toSafeModelFileName(basename(path), type, 'model')
                 }
              ]
            : [];
      });
      if (sources.length === 0) return failure(request.installId, 'unsupported-type');

      for (const source of sources) {
         const folder = await ensureContentFolder(modelFolderPath(install.path, source.type));
         if (!folder) return failure(request.installId, 'inspect-failed', source.type);
      }

      const installed = await installedKeys(request.installId);
      const operation = options.operations.start(
         {
            kind: 'import',
            title: translate('models.operations.import', { count: sources.length }),
            message: install.path,
            progress: {
               phase: 'preparing',
               current: 0,
               total: sources.length,
               percent: 0,
               unit: 'items'
            },
            metadata: { installId: request.installId }
         },
         (operationId, signal) =>
            runInstall(operationId, {
               installId: request.installId,
               installPath: install.path,
               sources,
               installed,
               signal
            })
      );

      return { ok: true, value: operation };
   }

   async function runInstall(operationId: string, input: Omit<InstallModelFilesInput, 'ingestion' | 'onProgress'> & { installId: InstallId }) {
      const outcome = await installModelFiles({
         ...input,
         ingestion,
         onProgress: (index, progress) => reportInstallProgress(operationId, index, input.sources.length, progress)
      });

      await rescan({ installId: input.installId });

      if (outcome.modelCount === 0) {
         options.operations.fail(operationId, outcome.lastProblem ?? createProblem('models.nothing-installed'));
         return;
      }

      options.operations.complete(operationId, {
         installId: input.installId,
         modelCount: outcome.modelCount,
         bytes: outcome.bytes,
         files: outcome.files
      });
   }

   async function startExport(request: ModelExportRequest): Promise<ModelOperationResult> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const totalBytes = selected.models.reduce((total, model) => total + model.sizeBytes, 0);
      const operation = options.operations.start(
         {
            kind: 'copy',
            title: translate('models.export', { count: selected.models.length }),
            message: request.destinationPath,
            progress: {
               phase: 'preparing',
               current: 0,
               total: totalBytes,
               percent: 0,
               unit: 'bytes'
            },
            metadata: {
               installId: request.installId,
               destinationPath: request.destinationPath
            }
         },
         (operationId, signal) => runExport(operationId, request, selected.models, signal)
      );

      return { ok: true, value: operation };
   }

   async function runExport(operationId: string, request: ModelExportRequest, models: LocalModelSummary[], signal: AbortSignal) {
      const exported = await exportModelsToZip({
         models,
         destinationPath: request.destinationPath,
         signal,
         onProgress: (progress) => options.operations.update(operationId, { progress })
      });

      if (Result.isError(exported)) return options.operations.fail(operationId, exported.error);

      options.operations.complete(operationId, {
         installId: request.installId,
         modelCount: exported.value.modelCount,
         bytes: exported.value.bytes,
         files: exported.value.files
      });
   }

   async function installedKeys(installId: InstallId) {
      const snapshot = await list({ installId });

      return new Set(snapshot.models.flatMap((model) => (model.hash ? [modelKey(model.type, model.hash)] : [])));
   }

   async function resolveSelection(request: ModelSelectionRequest): Promise<ResolvedSelection> {
      if (request.modelIds.length === 0) return { status: 'invalid', issue: 'no-selection' };

      const snapshot = await list({ installId: request.installId });
      const installPath = snapshot.installPath;
      if (!installPath || snapshot.status === 'missing') return { status: 'invalid', issue: 'models-missing' };

      const resolved = await resolveManagedEntries({
         ids: request.modelIds,
         entries: snapshot.models,
         idOf: (model) => model.id,
         pathOf: (model) => model.path,
         rootOf: (model) => modelFolderPath(installPath, model.type)
      });

      return resolved.status === 'invalid' ? resolved : { status: 'ok', models: resolved.entries };
   }

   function dispose() {
      states.dispose();
   }

   return {
      list,
      rescan,
      getModelPath,
      previewDelete,
      startDelete,
      search,
      lookup,
      startDownload,
      startImport,
      startExport,
      subscribe: states.subscribe,
      dispose
   };
}
