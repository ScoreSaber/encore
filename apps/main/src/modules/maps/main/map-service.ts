import { Result } from 'better-result';
import { z } from 'zod';

import { createContentScanCache } from '@/lib/content/content-cache';
import { createContentFailure, createOperationFailure } from '@/lib/content/content-errors';
import { createContentEvents } from '@/lib/content/content-events';
import { createContentIngestionService, type ContentIngestionService, type IngestArchiveRequest } from '@/lib/content/content-ingestion';
import type { ContentLimits } from '@/lib/content/content-limits';
import type { ContentStaging } from '@/lib/content/content-staging';
import type { ContentSource } from '@/lib/content/contract';
import { ensureContentFolder, isManagedPath, resolveManagedEntries } from '@/lib/content/managed-selection';
import { createScanStates, pruneScanCache, type ContentScanState } from '@/lib/content/scan-states';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import { createFilesystemProblem, createUniquePath, isSafeFileName, type FilesystemProblem } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import { scanInBatches } from '@/lib/filesystem/scan';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   createEmptyMapCollectionSnapshot,
   invalidMapAction,
   localMapSummarySchema,
   maxMapCoversPerRequest,
   mapCollectionSnapshotSchema,
   type BeatSaverMapSummary,
   type LocalMapSummary,
   type MapActionIssue,
   type MapCollectionRequest,
   type MapCollectionSnapshot,
   type MapCoversRequest,
   type MapDeletePreview,
   type MapDetailRequest,
   type MapDownloadRequest,
   type MapExportRequest,
   type MapHash,
   type MapImportRequest,
   type MapMetadataRequest,
   type MapMetadataResult,
   type MapOperationResult,
   type MapProblem,
   type MapSearchRequest,
   type MapSearchResult,
   type MapSelectionRequest
} from '@/modules/maps/contract';
import { beatSaverDownloadHosts, createBeatSaverCatalog, type BeatSaverCatalog } from '@/modules/maps/main/beatsaver-catalog';
import { createMapArchiveValidator, exportMapsToZip, readStagedMap } from '@/modules/maps/main/map-archive';
import { customLevelsPath } from '@/modules/maps/main/map-paths';
import { createMapProblem } from '@/modules/maps/main/map-problem';
import { scanCustomLevels, withMapDuplicateFlags, type MapScanCacheEntry } from '@/modules/maps/main/map-scanner';
import { createScoreSaberCatalog, type ScoreSaberCatalog } from '@/modules/maps/main/scoresaber/scoresaber-catalog';
import type { CreateOperationInput, OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress, createInstallProgress } from '@/modules/operations/main/progress';

import { readFile, realpath } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const actionIssueMessages = {
   'already-installed': 'this map is already in the install',
   'install-not-found': 'the install is not in the registry anymore',
   'inspect-failed': 'the map folder could not be inspected',
   'maps-missing': 'this install has no custom levels folder yet',
   'no-selection': 'no maps were selected',
   'no-source': 'no archive was chosen',
   'not-found': 'the map is not in this install anymore',
   'source-unavailable': 'BeatSaver did not return this map',
   'unsupported-target': 'this target cannot manage maps'
};

const mapContentLimits: Partial<ContentLimits> = {
   maxDownloadBytes: 128 * 1024 * 1024,
   maxArchiveBytes: 128 * 1024 * 1024,
   maxEntries: 200,
   maxEntryBytes: 64 * 1024 * 1024,
   maxTotalBytes: 256 * 1024 * 1024,
   maxPathDepth: 3
};

const coverMimeTypes = new Map([
   ['.jpeg', 'image/jpeg'],
   ['.jpg', 'image/jpeg'],
   ['.png', 'image/png'],
   ['.webp', 'image/webp']
]);

const maxCoverBytes = 4 * 1024 * 1024;
const maxCoverResponseCharacters = 6 * 1024 * 1024;
const mapScanCacheEntrySchema = z.object({
   fingerprint: z.string(),
   map: localMapSummarySchema
});

export type MapServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   dataPath: string;
   ingestion?: ContentIngestionService;
   staging?: ContentStaging;
   catalog?: BeatSaverCatalog;
   scoreSaber?: ScoreSaberCatalog;
};

type MapScanState = ContentScanState<MapCollectionSnapshot, MapScanCacheEntry, null>;

type SharedMapScan = {
   pending: Promise<Awaited<ReturnType<typeof scanCustomLevels>>>;
   cache: Map<string, MapScanCacheEntry>;
};

export type MapService = ReturnType<typeof createMapService>;

type ReadyDeletePreview = Extract<MapDeletePreview, { status: 'ok' }>;

type ResolvedSelection = { status: 'invalid'; issue: MapActionIssue } | { status: 'ok'; mapsPath: string; maps: LocalMapSummary[] };

type DeleteSelectionOutcome = {
   bytes: number;
   files: number;
   mapCount: number;
};

type InstallArchiveSource = {
   source: ContentSource;
   fallbackName: string;
   expectedHash?: MapHash;
};

type InstallArchiveOutcome = {
   bytes: number;
   files: number;
};

type InstallArchivesInput = {
   installId: InstallId;
   mapsPath: string;
   sources: InstallArchiveSource[];
   allowedHosts?: readonly string[];
   installed: Set<MapHash>;
   signal: AbortSignal;
};

export function createMapService(options: MapServiceOptions) {
   const ingestion =
      options.ingestion ??
      createContentIngestionService({
         dataPath: options.dataPath,
         limits: mapContentLimits,
         staging: options.staging
      });
   const catalog = options.catalog ?? createBeatSaverCatalog();
   const scoreSaber = options.scoreSaber ?? createScoreSaberCatalog();
   const events = createContentEvents<MapCollectionSnapshot>();
   const invalid = (installId: InstallId, issue: MapActionIssue, detail?: string) => invalidMapAction({ installId }, issue, detail);
   const failure = createContentFailure<MapActionIssue>('maps', actionIssueMessages);
   const failOperation = createOperationFailure(options.operations);
   const reportInstallProgress = createInstallProgress(options.operations);
   const reportBytesProgress = createBytesProgress(options.operations);
   const sharedScans = new Map<string, SharedMapScan>();
   const states = createScanStates<MapCollectionSnapshot, MapScanCacheEntry, null>({
      getInstallPath: async (installId) => (await options.registry.get(installId))?.path ?? null,
      emptySnapshot: (installId, status) => createEmptyMapCollectionSnapshot({ installId }, status),
      emptyExtra: () => null,
      runScan,
      publish: events.publish,
      cache: createContentScanCache({
         dataPath: options.dataPath,
         name: 'maps',
         snapshotSchema: mapCollectionSnapshotSchema,
         cacheEntrySchema: mapScanCacheEntrySchema,
         extraSchema: z.null()
      })
   });
   const { list: scan, rescan: rescanInstall } = states;

   function list(request: MapCollectionRequest) {
      return scan(request.installId);
   }

   function rescan(request: MapCollectionRequest) {
      return rescanInstall(request.installId);
   }

   async function runScan({ installId, installPath, state }: { installId: InstallId; installPath: string; state: MapScanState }) {
      const mapsPath = customLevelsPath(installPath);
      const resolvedMapsPath = await Result.tryPromise({
         try: () => realpath(mapsPath),
         catch: (cause) => cause
      });
      const shared = Result.isOk(resolvedMapsPath) ? sharedScans.get(resolvedMapsPath.value) : undefined;
      const canReuseSharedScan = state.snapshot.scannedAt === null && shared;

      if (shared) state.cache = rebaseMapCache(shared.cache, mapsPath);

      const pending = canReuseSharedScan
         ? shared.pending
         : scanCustomLevels({
              installPath,
              cache: state.cache,
              onProgress: (progress) => {
                 state.snapshot = { ...state.snapshot, status: 'scanning', progress };
                 if (!state.background) events.publish(state.snapshot);
              }
           });

      if (Result.isOk(resolvedMapsPath) && !canReuseSharedScan) {
         sharedScans.set(resolvedMapsPath.value, { pending, cache: state.cache });
      }

      const scanned = rebaseMapScan(await pending, mapsPath);

      pruneScanCache(state.cache, new Set(scanned.maps.map((map) => map.folderName)));

      state.snapshot = {
         installId,
         status: scanned.status,
         mapsPath: scanned.mapsPath,
         scannedAt: new Date().toISOString(),
         maps: scanned.maps,
         problems: scanned.problems,
         progress: null
      };

      return state.snapshot;
   }

   async function getCovers(request: MapCoversRequest) {
      const snapshot = await list({ installId: request.installId });
      const mapsPath = snapshot.mapsPath;
      if (!mapsPath) return { covers: [], deferredMapIds: [] };

      const maps = new Map(snapshot.maps.map((map) => [map.id, map]));
      const read = await scanInBatches(request.mapIds, { batchSize: maxMapCoversPerRequest }, async (mapId) => {
         const map = maps.get(mapId);
         if (!map || !(await isManagedPath(mapsPath, map.path))) return null;

         const dataUrl = await readCover(map);
         return dataUrl ? { mapId, dataUrl } : null;
      });
      const covers = [];
      const deferredMapIds = [];
      let responseCharacters = 0;

      for (const cover of read) {
         if (!cover) continue;
         if (responseCharacters + cover.dataUrl.length > maxCoverResponseCharacters) {
            deferredMapIds.push(cover.mapId);
            continue;
         }

         covers.push(cover);
         responseCharacters += cover.dataUrl.length;
      }

      return { covers, deferredMapIds };
   }

   async function readCover(map: LocalMapSummary) {
      if (!map.coverFileName || !isSafeFileName(map.coverFileName)) return null;

      const coverPath = join(map.path, map.coverFileName);
      const mimeType = coverMimeTypes.get(extname(coverPath).toLowerCase());
      if (!mimeType) return null;

      const bytes = await Result.tryPromise({
         try: () => readFile(coverPath),
         catch: (cause) => cause
      });
      if (Result.isError(bytes) || bytes.value.byteLength > maxCoverBytes) return null;

      return `data:${mimeType};base64,${bytes.value.toString('base64')}`;
   }

   async function getMetadata({ hash }: MapMetadataRequest): Promise<MapMetadataResult> {
      const [beatSaverResult, scoreSaberResult] = await Promise.all([catalog.getByHashes([hash]), scoreSaber.getByHash(hash)]);
      const beatSaverRecord = Result.isOk(beatSaverResult) ? beatSaverResult.value.get(hash) : null;

      return {
         beatSaver: beatSaverRecord?.listing ?? null,
         scoreSaberUrl: Result.isOk(scoreSaberResult) ? scoreSaberResult.value : null
      };
   }

   async function getMapPath(request: MapDetailRequest) {
      const located = await locateMap(request.installId, request.mapId);
      return located?.map.path ?? null;
   }

   async function previewDelete(request: MapSelectionRequest): Promise<MapDeletePreview> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return invalid(request.installId, selected.issue);

      const sizes = await scanInBatches(selected.maps, {}, (map) => getDirectorySize(map.path));

      let sizeBytes = 0;
      let fileCount = 0;
      for (const size of sizes) {
         if (Result.isError(size)) return invalid(request.installId, 'inspect-failed', size.error.detail);

         sizeBytes += size.value.bytes;
         fileCount += size.value.files;
      }

      return {
         status: 'ok',
         installId: request.installId,
         mapsPath: selected.mapsPath,
         names: selected.maps.map((map) => map.title || map.folderName),
         mapCount: selected.maps.length,
         sizeBytes,
         fileCount
      };
   }

   async function startDelete(request: MapSelectionRequest): Promise<MapOperationResult> {
      const previewed = await previewDelete(request);
      if (previewed.status === 'invalid') return failure(request.installId, previewed.issue, previewed.detail);

      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'delete',
         title: `Delete ${previewed.mapCount} ${previewed.mapCount === 1 ? 'map' : 'maps'}`,
         message: previewed.mapsPath,
         progress: {
            phase: 'preparing',
            current: 0,
            total: previewed.sizeBytes,
            percent: 0,
            unit: 'bytes'
         },
         metadata: { installId: request.installId, mapsPath: previewed.mapsPath },
         cancel: () => controller.abort()
      });

      void runDelete(operation.id, request, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runDelete(operationId: string, request: MapSelectionRequest, previewed: ReadyDeletePreview, signal: AbortSignal) {
      const deleted = await deleteSelection({
         request,
         signal,
         onProgress: ({ bytes, label }) => reportBytesProgress(operationId, 'deleting', bytes, previewed.sizeBytes, label)
      });

      if (Result.isError(deleted)) return failOperation(operationId, deleted.error);

      options.operations.complete(operationId, {
         installId: request.installId,
         mapCount: deleted.value.mapCount,
         bytes: deleted.value.bytes,
         files: deleted.value.files
      });
   }

   async function deleteSelection(input: {
      request: MapSelectionRequest;
      signal: AbortSignal;
      onProgress?: (progress: { bytes: number; label: string }) => void;
   }) {
      const selected = await resolveSelection(input.request);
      if (selected.status === 'invalid') {
         return Result.err<DeleteSelectionOutcome, FilesystemProblem>(
            createFilesystemProblem('filesystem.operation.delete-failed', actionIssueMessages[selected.issue])
         );
      }

      let bytes = 0;
      let files = 0;

      for (const map of selected.maps) {
         const deleted = await deletePathWithProgress({
            targetPath: map.path,
            root: selected.mapsPath,
            allowMissing: true,
            scope: 'content',
            signal: input.signal,
            onProgress: (progress) =>
               input.onProgress?.({
                  bytes: bytes + (progress.current ?? 0),
                  label: map.title || map.folderName
               })
         });

         if (Result.isError(deleted)) {
            await rescan({ installId: input.request.installId });
            return Result.err<DeleteSelectionOutcome, FilesystemProblem>(deleted.error);
         }

         bytes += deleted.value.bytes;
         files += deleted.value.files;
      }

      const state = states.get(input.request.installId);
      if (state) {
         const deletedIds = new Set(selected.maps.map((map) => map.id));
         const maps = withMapDuplicateFlags(state.snapshot.maps.filter((map) => !deletedIds.has(map.id)));

         for (const map of selected.maps) {
            state.cache.delete(map.folderName);
         }
         state.snapshot = { ...state.snapshot, maps };
         events.publish(state.snapshot);
      }

      return Result.ok<DeleteSelectionOutcome, FilesystemProblem>({
         bytes,
         files,
         mapCount: selected.maps.length
      });
   }

   async function findMapsByHash(installId: InstallId, hashes: Iterable<MapHash>) {
      const snapshot = await list({ installId });
      const wanted = new Set(hashes);

      return snapshot.maps.filter((map) => map.hash && wanted.has(map.hash));
   }

   async function search(request: MapSearchRequest): Promise<MapSearchResult> {
      const page = request.page ?? 0;
      const found = await catalog.search({ query: request.query, page });
      if (Result.isError(found)) {
         const result: MapSearchResult = { status: 'failed', issue: found.error.issue };
         if (found.error.detail) result.detail = found.error.detail;
         return result;
      }

      const installed = await installedHashes(request.installId);

      return {
         status: 'ok',
         query: request.query,
         page,
         hasMore: found.value.length >= catalog.pageSize,
         maps: found.value.map((record) => withInstalledFlag(record.summary, installed))
      };
   }

   async function lookup(key: string, installId?: InstallId) {
      const record = await catalog.getByKey(key);
      if (Result.isError(record)) return null;

      return withInstalledFlag(record.value.summary, installId ? await installedHashes(installId) : new Set<MapHash>());
   }

   async function startDownload(request: MapDownloadRequest): Promise<MapOperationResult> {
      const record = await catalog.getByKey(request.source.key);
      if (Result.isError(record)) return failure(request.installId, 'source-unavailable', record.error.detail);

      const mapsPath = await ensureMapsPath(request.installId);
      if (!mapsPath) return failure(request.installId, 'install-not-found');

      const installed = await installedHashes(request.installId);
      if (installed.has(record.value.summary.hash)) return failure(request.installId, 'already-installed', record.value.summary.title);

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: `Download ${record.value.summary.title}`,
         message: record.value.summary.mapper,
         progress: {
            phase: 'preparing',
            current: 0,
            total: 100,
            percent: 0,
            unit: 'items'
         },
         metadata: { installId: request.installId, key: record.value.summary.key },
         cancel: () => controller.abort()
      });

      void runInstall(operation.id, {
         installId: request.installId,
         mapsPath,
         sources: [
            {
               source: { kind: 'url', url: record.value.downloadUrl },
               fallbackName: record.value.summary.key,
               expectedHash: record.value.summary.hash
            }
         ],
         allowedHosts: beatSaverDownloadHosts,
         installed,
         signal: controller.signal
      });

      return { ok: true, value: operation };
   }

   async function startDownloadByHash(input: {
      installId: InstallId;
      hashes: MapHash[];
      title: string;
      message?: string;
   }): Promise<MapOperationResult> {
      const mapsPath = await ensureMapsPath(input.installId);
      if (!mapsPath) return failure(input.installId, 'install-not-found');

      const installed = await installedHashes(input.installId);
      const wanted = input.hashes.filter((hash) => !installed.has(hash));
      if (wanted.length === 0) return failure(input.installId, 'already-installed');

      const records = await catalog.getByHashes(wanted);
      if (Result.isError(records)) return failure(input.installId, 'source-unavailable', records.error.detail);
      if (records.value.size === 0) return failure(input.installId, 'source-unavailable');

      const controller = new AbortController();
      const sources: InstallArchiveSource[] = [...records.value.values()].map((record) => ({
         source: { kind: 'url', url: record.downloadUrl },
         fallbackName: record.summary.key,
         expectedHash: record.summary.hash
      }));
      const operationInput: CreateOperationInput = {
         kind: 'download',
         title: input.title,
         progress: {
            phase: 'preparing',
            current: 0,
            total: sources.length,
            percent: 0,
            unit: 'items'
         },
         metadata: { installId: input.installId, mapCount: sources.length },
         cancel: () => controller.abort()
      };
      if (input.message) operationInput.message = input.message;
      const operation = options.operations.create(operationInput);

      void runInstall(operation.id, {
         installId: input.installId,
         mapsPath,
         sources,
         allowedHosts: beatSaverDownloadHosts,
         installed,
         signal: controller.signal
      });

      return { ok: true, value: operation };
   }

   async function startImport(request: MapImportRequest): Promise<MapOperationResult> {
      if (request.paths.length === 0) return failure(request.installId, 'no-source');

      const mapsPath = await ensureMapsPath(request.installId);
      if (!mapsPath) return failure(request.installId, 'install-not-found');

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'import',
         title: `Import ${request.paths.length} ${request.paths.length === 1 ? 'map' : 'maps'}`,
         message: mapsPath,
         progress: {
            phase: 'preparing',
            current: 0,
            total: request.paths.length,
            percent: 0,
            unit: 'items'
         },
         metadata: { installId: request.installId },
         cancel: () => controller.abort()
      });

      void runInstall(operation.id, {
         installId: request.installId,
         mapsPath,
         sources: request.paths.map((path) => ({
            source: { kind: 'file', path },
            fallbackName: basename(path, '.zip')
         })),
         installed: await installedHashes(request.installId),
         signal: controller.signal
      });

      return { ok: true, value: operation };
   }

   async function runInstall(operationId: string, input: InstallArchivesInput) {
      let bytes = 0;
      let files = 0;
      let mapCount = 0;
      let lastProblem: MapProblem | null = null;

      for (const [index, entry] of input.sources.entries()) {
         if (input.signal.aborted) break;

         const installed = await installArchive({
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
         mapCount += 1;
      }

      await rescan({ installId: input.installId });

      if (mapCount === 0) {
         const problem = lastProblem ?? createMapProblem('maps.folder.unreadable', 'no map was installed');
         options.operations.fail(operationId, {
            code: problem.code,
            message: problem.message,
            details: { detail: problem.detail }
         });
         return;
      }

      options.operations.complete(operationId, {
         installId: input.installId,
         mapCount,
         bytes,
         files
      });
   }

   async function installArchive(input: InstallArchivesInput & InstallArchiveSource & { operationId: string; index: number }) {
      const request: IngestArchiveRequest = {
         source: input.source,
         targetKind: 'local',
         limits: mapContentLimits,
         signal: input.signal,
         validate: createMapArchiveValidator(),
         onProgress: (progress) => reportInstallProgress(input.operationId, input.index, input.sources.length, progress)
      };
      if (input.allowedHosts) request.urlPolicy = { allowedHosts: input.allowedHosts };
      const staged = await ingestion.ingestArchive(request);
      if (Result.isError(staged)) {
         return Result.err<InstallArchiveOutcome, MapProblem>(
            createMapProblem('maps.info.invalid', staged.error.message, {
               folderName: input.fallbackName,
               cause: staged.error.code
            })
         );
      }

      const map = await readStagedMap(staged.value.extractedPath, input.fallbackName);
      if (Result.isError(map)) {
         await staged.value.dispose();
         return Result.err<InstallArchiveOutcome, MapProblem>(map.error);
      }

      if (input.expectedHash && input.expectedHash !== map.value.hash) {
         await staged.value.dispose();
         return Result.err<InstallArchiveOutcome, MapProblem>(
            createMapProblem('maps.hash.failed', 'the downloaded map does not match the hash BeatSaver published', {
               folderName: map.value.folderName
            })
         );
      }

      if (input.installed.has(map.value.hash)) {
         await staged.value.dispose();
         return Result.err<InstallArchiveOutcome, MapProblem>(
            createMapProblem('maps.info.invalid', 'this map is already in the install', { folderName: map.value.folderName })
         );
      }

      const destinationPath = await createUniquePath(join(input.mapsPath, map.value.folderName));
      if (Result.isError(destinationPath)) {
         await staged.value.dispose();
         return Result.err<InstallArchiveOutcome, MapProblem>(
            createMapProblem('maps.folder.unreadable', destinationPath.error.message, { folderName: map.value.folderName })
         );
      }

      const committed = await staged.value.commit({
         destinationPath: destinationPath.value,
         destinationRoot: input.mapsPath,
         signal: input.signal,
         onProgress: (progress) => reportInstallProgress(input.operationId, input.index, input.sources.length, progress)
      });
      if (Result.isError(committed)) {
         return Result.err<InstallArchiveOutcome, MapProblem>(
            createMapProblem('maps.folder.unreadable', committed.error.message, {
               folderName: map.value.folderName,
               cause: committed.error.code
            })
         );
      }

      input.installed.add(map.value.hash);

      return Result.ok<InstallArchiveOutcome, MapProblem>({
         bytes: committed.value.bytes,
         files: committed.value.files
      });
   }

   async function startExport(request: MapExportRequest): Promise<MapOperationResult> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const controller = new AbortController();
      const totalBytes = selected.maps.reduce((total, map) => total + map.sizeBytes, 0);
      const operation = options.operations.create({
         kind: 'copy',
         title: `Export ${selected.maps.length} ${selected.maps.length === 1 ? 'map' : 'maps'}`,
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

      void runExport(operation.id, request, selected.maps, controller.signal);

      return { ok: true, value: operation };
   }

   async function runExport(operationId: string, request: MapExportRequest, maps: LocalMapSummary[], signal: AbortSignal) {
      const exported = await exportMapsToZip({
         maps,
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
         mapCount: exported.value.mapCount,
         bytes: exported.value.bytes,
         files: exported.value.files
      });
   }

   async function ensureMapsPath(installId: InstallId) {
      const snapshot = await list({ installId });
      if (snapshot.mapsPath && snapshot.status !== 'missing') return snapshot.mapsPath;

      const install = await options.registry.get(installId);

      return install ? ensureContentFolder(customLevelsPath(install.path)) : null;
   }

   async function installedHashes(installId: InstallId) {
      const snapshot = await list({ installId });

      return new Set(snapshot.maps.flatMap((map) => (map.hash ? [map.hash] : [])));
   }

   function withInstalledFlag(summary: BeatSaverMapSummary, installed: Set<MapHash>): BeatSaverMapSummary {
      return { ...summary, installed: installed.has(summary.hash) };
   }

   async function resolveSelection(request: MapSelectionRequest): Promise<ResolvedSelection> {
      if (request.mapIds.length === 0) return { status: 'invalid', issue: 'no-selection' };

      const snapshot = await list({ installId: request.installId });
      const mapsPath = snapshot.mapsPath;
      if (!mapsPath || snapshot.status === 'missing') return { status: 'invalid', issue: 'maps-missing' };

      const resolved = await resolveManagedEntries({
         ids: request.mapIds,
         entries: snapshot.maps,
         idOf: (map) => map.id,
         pathOf: (map) => map.path,
         rootOf: () => mapsPath
      });

      return resolved.status === 'invalid' ? resolved : { status: 'ok', mapsPath, maps: resolved.entries };
   }

   async function locateMap(installId: InstallId, mapId: string) {
      const snapshot = await list({ installId });
      const map = snapshot.maps.find((entry) => entry.id === mapId);
      if (!map || !snapshot.mapsPath) return null;

      return (await isManagedPath(snapshot.mapsPath, map.path)) ? { snapshot, map } : null;
   }

   function dispose() {
      events.dispose();
      states.dispose();
      sharedScans.clear();
   }

   return {
      list,
      rescan,
      getCovers,
      getMetadata,
      getMapPath,
      previewDelete,
      startDelete,
      deleteSelection,
      findMapsByHash,
      search,
      lookup,
      startDownload,
      startDownloadByHash,
      startImport,
      startExport,
      subscribe: events.subscribe,
      dispose
   };
}

function rebaseMapScan(scanned: Awaited<ReturnType<typeof scanCustomLevels>>, mapsPath: string) {
   return {
      ...scanned,
      mapsPath,
      maps: scanned.maps.map((map) => ({ ...map, path: join(mapsPath, map.folderName) }))
   };
}

function rebaseMapCache(cache: Map<string, MapScanCacheEntry>, mapsPath: string) {
   return new Map([...cache].map(([folderName, entry]) => [folderName, { ...entry, map: { ...entry.map, path: join(mapsPath, folderName) } }]));
}
