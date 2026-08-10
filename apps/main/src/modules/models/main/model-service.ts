import { Result } from 'better-result';
import { z } from 'zod';

import { createContentScanCache } from '@/lib/content/content-cache';
import { createContentFailure, createOperationFailure } from '@/lib/content/content-errors';
import { createContentEvents } from '@/lib/content/content-events';
import { createContentIngestionService, type ContentIngestionService } from '@/lib/content/content-ingestion';
import type { ContentLimits } from '@/lib/content/content-limits';
import type { ContentStaging } from '@/lib/content/content-staging';
import type { ContentProblem, ContentSource } from '@/lib/content/contract';
import { ensureContentFolder, isManagedPath, resolveManagedEntries } from '@/lib/content/managed-selection';
import { createScanStates, pruneScanCache, type ContentScanState } from '@/lib/content/scan-states';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import { createFilesystemProblem, pathExists, type FilesystemProblem } from '@/lib/filesystem/path';
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
   type ModelCollectionRequest,
   type ModelCollectionSnapshot,
   type ModelDeletePreview,
   type ModelDetailRequest,
   type ModelDownloadRequest,
   type ModelExportRequest,
   type ModelHash,
   type ModelImportRequest,
   type ModelOperationResult,
   type ModelProblem,
   type ModelSaberModelSummary,
   type ModelSearchRequest,
   type ModelSearchResult,
   type ModelSelectionRequest,
   type ModelType
} from '@/modules/models/contract';
import { exportModelsToZip } from '@/modules/models/main/model-archive';
import { computeModelHash } from '@/modules/models/main/model-hash';
import { createModelIndex, type ModelIndex } from '@/modules/models/main/model-index';
import { modelDisplayName, modelExtension, modelFolderPath, modelTypeForFileName, toSafeModelFileName } from '@/modules/models/main/model-paths';
import { createModelProblem } from '@/modules/models/main/model-problem';
import { createModelSaberCatalog, modelSaberDownloadHosts, type ModelSaberCatalog } from '@/modules/models/main/model-saber-catalog';
import { scanModelFolders, type ModelScanCacheEntry } from '@/modules/models/main/model-scanner';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress, createInstallProgress } from '@/modules/operations/main/progress';

import { basename, join } from 'node:path';

const actionIssueMessages: Record<ModelActionIssue, string> = {
   'already-installed': 'this model is already in the install',
   'inspect-failed': 'the model could not be inspected',
   'install-not-found': 'the install is not in the registry anymore',
   'models-missing': 'this install has no model folders yet',
   'no-selection': 'no models were selected',
   'no-source': 'no model file was chosen',
   'not-found': 'the model is not in this install anymore',
   'source-unavailable': 'ModelSaber did not return this model',
   'unsupported-target': 'this target cannot manage models',
   'unsupported-type': 'this kind of model is not supported'
};

function modelKey(type: ModelType, hash: ModelHash) {
   return `${type}:${hash}`;
}

const modelScanCacheEntrySchema = z.object({
   fingerprint: z.string(),
   model: localModelSummarySchema
});

const modelContentLimits: Partial<ContentLimits> = {
   maxDownloadBytes: 256 * 1024 * 1024
};

type ModelServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   dataPath: string;
   ingestion?: ContentIngestionService;
   staging?: ContentStaging;
   catalog?: ModelSaberCatalog;
   index?: ModelIndex;
};

type ModelScanState = ContentScanState<ModelCollectionSnapshot, ModelScanCacheEntry, null>;

export type ModelService = ReturnType<typeof createModelService>;

type ReadyDeletePreview = Extract<ModelDeletePreview, { status: 'ok' }>;

type ResolvedSelection = { status: 'invalid'; issue: ModelActionIssue } | { status: 'ok'; models: LocalModelSummary[] };

type InstallModelSource = {
   source: ContentSource;
   type: ModelType;
   fileName: string;
   expectedHash?: ModelHash;
};

type InstallModelsInput = {
   installId: InstallId;
   installPath: string;
   sources: InstallModelSource[];
   allowedHosts?: readonly string[];
   installed: Set<string>;
   signal: AbortSignal;
};

export function createModelService(options: ModelServiceOptions) {
   const ingestion =
      options.ingestion ??
      createContentIngestionService({
         dataPath: options.dataPath,
         limits: modelContentLimits,
         staging: options.staging
      });
   const catalog = options.catalog ?? createModelSaberCatalog();
   const modelIndex = options.index ?? createModelIndex({ dataPath: options.dataPath });
   const events = createContentEvents<ModelCollectionSnapshot>();
   const failure = createContentFailure<ModelActionIssue>('models', actionIssueMessages);
   const failOperation = createOperationFailure(options.operations);
   const reportInstallProgress = createInstallProgress(options.operations);
   const reportBytesProgress = createBytesProgress(options.operations);
   const states = createScanStates<ModelCollectionSnapshot, ModelScanCacheEntry, null>({
      getInstallPath: async (installId) => (await options.registry.get(installId))?.path ?? null,
      emptySnapshot: (installId, status) => createEmptyModelCollectionSnapshot({ installId }, status),
      emptyExtra: () => null,
      runScan,
      publish: events.publish,
      cache: createContentScanCache({
         dataPath: options.dataPath,
         name: 'models',
         snapshotSchema: modelCollectionSnapshotSchema,
         cacheEntrySchema: modelScanCacheEntrySchema,
         extraSchema: z.null()
      })
   });
   const { list: scan, rescan: rescanInstall } = states;

   function list(request: ModelCollectionRequest) {
      return scan(request.installId);
   }

   function rescan(request: ModelCollectionRequest) {
      return rescanInstall(request.installId);
   }

   async function runScan({ installId, installPath, state }: { installId: InstallId; installPath: string; state: ModelScanState }) {
      const scanned = await scanModelFolders({
         installPath,
         cache: state.cache,
         onProgress: (progress) => {
            state.snapshot = { ...state.snapshot, status: 'scanning', progress };
            if (!state.background) events.publish(state.snapshot);
         }
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
      const located = await locateModel(request.installId, request.modelId);
      return located?.path ?? null;
   }

   async function previewDelete(request: ModelSelectionRequest): Promise<ModelDeletePreview> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return invalidModelAction({ installId: request.installId }, selected.issue);

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

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'delete',
         title: `Delete ${previewed.modelCount} ${previewed.modelCount === 1 ? 'model' : 'models'}`,
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
         },
         cancel: () => controller.abort()
      });

      void runDelete(operation.id, request, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runDelete(operationId: string, request: ModelSelectionRequest, previewed: ReadyDeletePreview, signal: AbortSignal) {
      const deleted = await deleteSelection({
         request,
         signal,
         onProgress: ({ bytes, label }) => reportBytesProgress(operationId, 'deleting', bytes, previewed.sizeBytes, label)
      });

      if (Result.isError(deleted)) return failOperation(operationId, deleted.error);

      options.operations.complete(operationId, {
         installId: request.installId,
         modelCount: deleted.value.modelCount,
         bytes: deleted.value.bytes,
         files: deleted.value.files
      });
   }

   async function deleteSelection(input: {
      request: ModelSelectionRequest;
      signal: AbortSignal;
      onProgress?: (progress: { bytes: number; label: string }) => void;
   }) {
      const selected = await resolveSelection(input.request);
      if (selected.status === 'invalid') {
         return Result.err<{ bytes: number; files: number; modelCount: number }, FilesystemProblem>(
            createFilesystemProblem('filesystem.operation.delete-failed', actionIssueMessages[selected.issue])
         );
      }

      const install = await options.registry.get(input.request.installId);
      if (!install) {
         return Result.err<{ bytes: number; files: number; modelCount: number }, FilesystemProblem>(
            createFilesystemProblem('filesystem.operation.delete-failed', actionIssueMessages['install-not-found'])
         );
      }

      let bytes = 0;
      let files = 0;

      for (const model of selected.models) {
         const deleted = await deletePathWithProgress({
            targetPath: model.path,
            root: modelFolderPath(install.path, model.type),
            allowMissing: true,
            scope: 'content',
            signal: input.signal,
            onProgress: (progress) =>
               input.onProgress?.({
                  bytes: bytes + (progress.current ?? 0),
                  label: model.name || model.fileName
               })
         });

         if (Result.isError(deleted)) {
            await rescan({ installId: input.request.installId });
            return Result.err<{ bytes: number; files: number; modelCount: number }, FilesystemProblem>(deleted.error);
         }

         bytes += deleted.value.bytes;
         files += deleted.value.files;
      }

      await rescan({ installId: input.request.installId });

      return Result.ok<{ bytes: number; files: number; modelCount: number }, FilesystemProblem>({
         bytes,
         files,
         modelCount: selected.models.length
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
      if (Result.isError(found))
         return {
            status: 'failed',
            issue: found.error.issue,
            ...(found.error.detail ? { detail: found.error.detail } : {})
         };

      const installed = await installedKeys(request.installId);
      for (const record of found.value) {
         await modelIndex.remember(record.summary);
      }
      await modelIndex.flush();

      return {
         status: 'ok',
         type: request.type,
         query: request.query,
         page,
         hasMore: found.value.length >= catalog.pageSize,
         models: found.value.map((record) => withInstalledFlag(record.summary, installed))
      };
   }

   async function lookup(id: string, installId?: InstallId) {
      const record = await catalog.getById(id);
      if (Result.isError(record)) return null;

      await modelIndex.remember(record.value.summary);
      await modelIndex.flush();

      return withInstalledFlag(record.value.summary, installId ? await installedKeys(installId) : new Set<string>());
   }

   async function startDownload(request: ModelDownloadRequest): Promise<ModelOperationResult> {
      const record = await catalog.getById(request.source.id);
      if (Result.isError(record)) return failure(request.installId, 'source-unavailable', record.error.detail);

      const summary = record.value.summary;
      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'install-not-found');

      const installed = await installedKeys(request.installId);
      if (installed.has(modelKey(summary.type, summary.hash))) return failure(request.installId, 'already-installed', summary.name);

      const folder = await ensureModelFolder(install.path, summary.type);
      if (!folder) return failure(request.installId, 'inspect-failed', summary.type);

      await modelIndex.remember(summary);
      await modelIndex.flush();

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: `Download ${summary.name}`,
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
         },
         cancel: () => controller.abort()
      });

      void runInstall(operation.id, {
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
         allowedHosts: modelSaberDownloadHosts,
         installed,
         signal: controller.signal
      });

      return { ok: true, value: operation };
   }

   async function startImport(request: ModelImportRequest): Promise<ModelOperationResult> {
      if (request.paths.length === 0) return failure(request.installId, 'no-source');

      const install = await options.registry.get(request.installId);
      if (!install) return failure(request.installId, 'install-not-found');

      const sources: InstallModelSource[] = request.paths.flatMap((path) => {
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
         const folder = await ensureModelFolder(install.path, source.type);
         if (!folder) return failure(request.installId, 'inspect-failed', source.type);
      }

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'import',
         title: `Import ${sources.length} ${sources.length === 1 ? 'model' : 'models'}`,
         message: install.path,
         progress: {
            phase: 'preparing',
            current: 0,
            total: sources.length,
            percent: 0,
            unit: 'items'
         },
         metadata: { installId: request.installId },
         cancel: () => controller.abort()
      });

      void runInstall(operation.id, {
         installId: request.installId,
         installPath: install.path,
         sources,
         installed: await installedKeys(request.installId),
         signal: controller.signal
      });

      return { ok: true, value: operation };
   }

   async function runInstall(operationId: string, input: InstallModelsInput) {
      let bytes = 0;
      let files = 0;
      let modelCount = 0;
      let lastProblem: ModelProblem | null = null;

      for (const [index, entry] of input.sources.entries()) {
         if (input.signal.aborted) break;

         const installed = await installModel({
            ...input,
            ...entry,
            operationId,
            index
         });
         if (Result.isError(installed)) {
            lastProblem = installed.error;
            continue;
         }

         bytes += installed.value.bytes;
         files += installed.value.files;
         modelCount += 1;
      }

      await rescan({ installId: input.installId });

      if (modelCount === 0) {
         const problem = lastProblem ?? createModelProblem('models.import.rejected', 'no model was installed');
         options.operations.fail(operationId, {
            code: problem.code,
            message: problem.message,
            details: { detail: problem.detail }
         });
         return;
      }

      options.operations.complete(operationId, {
         installId: input.installId,
         modelCount,
         bytes,
         files
      });
   }

   async function installModel(input: InstallModelsInput & InstallModelSource & { operationId: string; index: number }) {
      const folderPath = modelFolderPath(input.installPath, input.type);
      const staged = await ingestion.ingestFile({
         source: input.source,
         targetKind: 'local',
         limits: modelContentLimits,
         fileName: input.fileName,
         ...(input.allowedHosts ? { urlPolicy: { allowedHosts: input.allowedHosts } } : {}),
         signal: input.signal,
         validate: ({ fileName }) =>
            modelTypeForFileName(fileName) === input.type
               ? Result.ok<void, ContentProblem>(undefined)
               : Result.err<void, ContentProblem>({
                    code: 'content.ingest.layout-rejected',
                    message: `this file is not a ${input.type} model`,
                    detail: modelExtension(input.type)
                 }),
         onProgress: (progress) => reportInstallProgress(input.operationId, input.index, input.sources.length, progress)
      });
      if (Result.isError(staged)) {
         return Result.err<{ bytes: number; files: number }, ModelProblem>(
            createModelProblem('models.import.rejected', staged.error.message, {
               type: input.type,
               fileName: input.fileName,
               cause: staged.error.code
            })
         );
      }

      const hash = await computeModelHash({
         path: staged.value.path,
         fileName: input.fileName,
         type: input.type
      });
      if (Result.isError(hash)) {
         await staged.value.dispose();
         return Result.err<{ bytes: number; files: number }, ModelProblem>(hash.error);
      }

      if (input.expectedHash && input.expectedHash !== hash.value) {
         await staged.value.dispose();
         return Result.err<{ bytes: number; files: number }, ModelProblem>(
            createModelProblem('models.import.rejected', 'the downloaded model did not match what ModelSaber described', {
               type: input.type,
               fileName: input.fileName
            })
         );
      }

      if (input.installed.has(modelKey(input.type, hash.value))) {
         await staged.value.dispose();
         return Result.err<{ bytes: number; files: number }, ModelProblem>(
            createModelProblem('models.import.rejected', 'this model is already in the install', { type: input.type, fileName: input.fileName })
         );
      }

      const destinationPath = await uniqueModelPath(folderPath, staged.value.fileName);
      if (Result.isError(destinationPath)) {
         await staged.value.dispose();
         return Result.err<{ bytes: number; files: number }, ModelProblem>(
            createModelProblem('models.import.rejected', destinationPath.error.message, { type: input.type, fileName: input.fileName })
         );
      }

      const committed = await staged.value.commit({
         destinationPath: destinationPath.value,
         destinationRoot: folderPath,
         signal: input.signal,
         onProgress: (progress) => reportInstallProgress(input.operationId, input.index, input.sources.length, progress)
      });
      if (Result.isError(committed)) {
         return Result.err<{ bytes: number; files: number }, ModelProblem>(
            createModelProblem('models.import.rejected', committed.error.message, {
               type: input.type,
               fileName: input.fileName,
               cause: committed.error.code
            })
         );
      }

      input.installed.add(modelKey(input.type, hash.value));

      return Result.ok<{ bytes: number; files: number }, ModelProblem>({
         bytes: committed.value.bytes,
         files: committed.value.files
      });
   }

   async function startExport(request: ModelExportRequest): Promise<ModelOperationResult> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const controller = new AbortController();
      const totalBytes = selected.models.reduce((total, model) => total + model.sizeBytes, 0);
      const operation = options.operations.create({
         kind: 'copy',
         title: `Export ${selected.models.length} ${selected.models.length === 1 ? 'model' : 'models'}`,
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
         },
         cancel: () => controller.abort()
      });

      void runExport(operation.id, request, selected.models, controller.signal);

      return { ok: true, value: operation };
   }

   async function runExport(operationId: string, request: ModelExportRequest, models: LocalModelSummary[], signal: AbortSignal) {
      const exported = await exportModelsToZip({
         models,
         destinationPath: request.destinationPath,
         signal,
         onProgress: (progress) => options.operations.update(operationId, { progress })
      });

      if (Result.isError(exported)) {
         options.operations.fail(operationId, {
            code: exported.error.code,
            message: exported.error.message,
            details: { detail: exported.error.detail }
         });
         return;
      }

      options.operations.complete(operationId, {
         installId: request.installId,
         modelCount: exported.value.modelCount,
         bytes: exported.value.bytes,
         files: exported.value.files
      });
   }

   async function ensureModelFolder(installPath: string, type: ModelType) {
      return ensureContentFolder(modelFolderPath(installPath, type));
   }

   async function uniqueModelPath(folderPath: string, fileName: string) {
      const extension = modelExtension(modelTypeForFileName(fileName) ?? 'saber');
      const base = modelDisplayName(fileName);

      for (let attempt = 1; attempt <= 200; attempt += 1) {
         const candidate = join(folderPath, attempt === 1 ? fileName : `${base} (${attempt})${extension}`);
         const exists = await pathExists(candidate);
         if (Result.isError(exists)) return Result.err<string, FilesystemProblem>(exists.error);

         if (!exists.value) return Result.ok<string, FilesystemProblem>(candidate);
      }

      return Result.err<string, FilesystemProblem>({
         code: 'filesystem.operation.destination-exists',
         message: 'could not find a free file name',
         path: folderPath
      });
   }

   async function installedKeys(installId: InstallId) {
      const snapshot = await list({ installId });

      return new Set(snapshot.models.flatMap((model) => (model.hash ? [modelKey(model.type, model.hash)] : [])));
   }

   function withInstalledFlag(summary: ModelSaberModelSummary, installed: Set<string>): ModelSaberModelSummary {
      return {
         ...summary,
         installed: installed.has(modelKey(summary.type, summary.hash))
      };
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

   async function locateModel(installId: InstallId, modelId: string) {
      const snapshot = await list({ installId });
      const model = snapshot.models.find((entry) => entry.id === modelId);
      if (!model || !snapshot.installPath) return null;

      return (await isManagedPath(modelFolderPath(snapshot.installPath, model.type), model.path)) ? model : null;
   }

   function dispose() {
      events.dispose();
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
      subscribe: events.subscribe,
      dispose
   };
}
