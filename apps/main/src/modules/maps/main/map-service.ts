import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcFailureResult } from '@/ipc/core';
import type { TargetUploadFailure } from '@/lib/api';
import type { ContentFetch } from '@/lib/content/content-download';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import type { ContentStaging } from '@/lib/content/content-staging';
import { deleteManagedEntries, ensureContentFolder, isManagedPath, resolveManagedEntries } from '@/lib/content/managed-selection';
import { createScanStates, pruneScanCache, type ScanRequest } from '@/lib/content/scan-states';
import { createProblem, type Problem } from '@/lib/errors';
import { getDirectorySize, scanInBatches } from '@/lib/filesystem/scan';
import { translate } from '@/lib/messages';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   createEmptyMapCollectionSnapshot,
   invalidMapAction,
   localMapSummarySchema,
   maxMapCoversPerRequest,
   mapCollectionSnapshotSchema,
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
   type MapSearchRequest,
   type MapSelectionRequest
} from '@/modules/maps/contract';
import { beatSaverDownloadHosts, createBeatSaverCatalog, searchBeatSaver, type BeatSaverCatalog } from '@/modules/maps/main/beatsaver-catalog';
import { exportMapsToZip, openMapArchive } from '@/modules/maps/main/map-archive';
import { coverDataUrl, coverMimeType, packCovers } from '@/modules/maps/main/map-covers';
import { installMapArchives, receiveMapArchive, type InstallMapArchivesInput, type MapArchiveSource } from '@/modules/maps/main/map-install';
import { customLevelsPath } from '@/modules/maps/main/map-paths';
import { scanCustomLevels, withMapDuplicateFlags, type MapScanCacheEntry } from '@/modules/maps/main/map-scanner';
import { fetchScoreSaberMapUrl } from '@/modules/maps/main/scoresaber/scoresaber-catalog';
import type { CreateOperationInput, OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress, createInstallProgress } from '@/modules/operations/main/operation-reporting';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { readFile, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';

export function mapFailure(installId: InstallId, issue: MapActionIssue, detail?: string): IpcFailureResult {
   return { ok: false, error: createProblem(`maps.${issue}`, { installId, detail }) };
}

const mapScanCacheEntrySchema = z.object({
   fingerprint: z.string(),
   map: localMapSummarySchema
});

type MapServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   dataPath: string;
   log: AppLogWriter;
   staging?: ContentStaging;
   fetchContent?: ContentFetch;
   catalog?: BeatSaverCatalog;
};

type SharedMapScan = {
   pending: Promise<Awaited<ReturnType<typeof scanCustomLevels>>> | null;
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

export function createMapService(options: MapServiceOptions) {
   const ingestion = createContentIngestionService({
      dataPath: options.dataPath,
      staging: options.staging,
      fetchContent: options.fetchContent
   });
   const catalog = options.catalog ?? createBeatSaverCatalog();
   const reportInstallProgress = createInstallProgress(options.operations);
   const reportBytesProgress = createBytesProgress(options.operations);
   const sharedScans = new Map<string, SharedMapScan>();
   const states = createScanStates({
      dataPath: options.dataPath,
      log: options.log,
      cacheName: 'maps',
      snapshotSchema: mapCollectionSnapshotSchema,
      cacheEntrySchema: mapScanCacheEntrySchema,
      extraSchema: z.null(),
      emptyExtra: null,
      getInstallPath: async (installId) => (await options.registry.get(installId))?.path ?? null,
      emptySnapshot: (installId, status) => createEmptyMapCollectionSnapshot({ installId }, status),
      runScan
   });
   const { list, rescan } = states;

   async function runScan({ installId, installPath, state, onProgress }: ScanRequest<MapCollectionSnapshot, MapScanCacheEntry, null>) {
      const mapsPath = customLevelsPath(installPath);
      const sharedKey = await resolveFolder(mapsPath);
      const shared = sharedKey ? sharedScans.get(sharedKey) : undefined;
      const inFlight = state.snapshot.scannedAt === null ? shared?.pending : null;

      if (shared) state.cache = rebaseMapCache(shared.cache, mapsPath);

      const pending = inFlight ?? scanCustomLevels({ installPath, cache: state.cache, onProgress });
      const started: SharedMapScan | null = inFlight ? null : { pending, cache: state.cache };
      if (started && sharedKey) sharedScans.set(sharedKey, started);

      let scanned: Awaited<ReturnType<typeof scanCustomLevels>>;
      try {
         scanned = rebaseMapScan(await pending, mapsPath);
      } finally {
         if (started) started.pending = null;
      }

      pruneScanCache(state.cache, new Set(scanned.maps.map((map) => map.folderName)));
      if (sharedKey) sharedScans.set(sharedKey, { pending: null, cache: state.cache });

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
      return packCovers(read);
   }

   async function readCover(map: LocalMapSummary) {
      const coverFileName = map.coverFileName;
      const mimeType = coverFileName ? coverMimeType(coverFileName) : null;
      if (!coverFileName || !mimeType) return null;

      const bytes = await Result.tryPromise({
         try: () => readFile(join(map.path, coverFileName)),
         catch: (cause) => cause
      });
      return Result.isOk(bytes) ? coverDataUrl(mimeType, bytes.value) : null;
   }

   async function getMetadata({ hash }: MapMetadataRequest): Promise<MapMetadataResult> {
      const [beatSaverResult, scoreSaberResult] = await Promise.all([catalog.getByHashes([hash]), fetchScoreSaberMapUrl(hash)]);
      const beatSaverRecord = Result.isOk(beatSaverResult) ? beatSaverResult.value.get(hash) : null;

      return {
         beatSaver: beatSaverRecord?.listing ?? null,
         scoreSaberUrl: Result.isOk(scoreSaberResult) ? scoreSaberResult.value : null
      };
   }

   async function getMapPath(request: MapDetailRequest) {
      const snapshot = await list({ installId: request.installId });
      const map = snapshot.maps.find((entry) => entry.id === request.mapId);
      if (!map || !snapshot.mapsPath) return null;

      return (await isManagedPath(snapshot.mapsPath, map.path)) ? map.path : null;
   }

   async function previewDelete(request: MapSelectionRequest): Promise<MapDeletePreview> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return invalidMapAction(request, selected.issue);

      const sizes = await scanInBatches(selected.maps, {}, (map) => getDirectorySize(map.path));

      let sizeBytes = 0;
      let fileCount = 0;
      for (const size of sizes) {
         if (Result.isError(size)) return invalidMapAction(request, 'inspect-failed', size.error.detail);

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
      if (previewed.status === 'invalid') return mapFailure(request.installId, previewed.issue, previewed.detail);

      const operation = options.operations.start(
         {
            kind: 'delete',
            title: translate('maps.actions.delete.action', { count: previewed.mapCount }),
            message: previewed.mapsPath,
            progress: {
               phase: 'preparing',
               current: 0,
               total: previewed.sizeBytes,
               percent: 0,
               unit: 'bytes'
            },
            metadata: { installId: request.installId, mapsPath: previewed.mapsPath }
         },
         (operationId, signal) => runDelete(operationId, request, previewed, signal)
      );

      return { ok: true, value: operation };
   }

   async function runDelete(operationId: string, request: MapSelectionRequest, previewed: ReadyDeletePreview, signal: AbortSignal) {
      const deleted = await deleteSelection({
         request,
         signal,
         onProgress: ({ bytes, label }) => reportBytesProgress(operationId, 'deleting', bytes, previewed.sizeBytes, label)
      });

      if (Result.isError(deleted)) return options.operations.fail(operationId, deleted.error);

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
      onProgress: (progress: { bytes: number; label: string }) => void;
   }) {
      const selected = await resolveSelection(input.request);
      if (selected.status === 'invalid') {
         return Result.err<DeleteSelectionOutcome, Problem>(createProblem(`maps.${selected.issue}`));
      }

      const deleted = await deleteManagedEntries(
         selected.maps.map((map) => ({ path: map.path, root: selected.mapsPath, label: map.title || map.folderName })),
         input
      );
      if (Result.isError(deleted)) {
         await rescan({ installId: input.request.installId });
         await syncSharedFolder(input.request.installId);
         return Result.err<DeleteSelectionOutcome, Problem>(deleted.error);
      }

      const state = states.get(input.request.installId);
      if (state) {
         const deletedIds = new Set(selected.maps.map((map) => map.id));
         const maps = withMapDuplicateFlags(state.snapshot.maps.filter((map) => !deletedIds.has(map.id)));

         for (const map of selected.maps) {
            state.cache.delete(map.folderName);
         }
         state.snapshot = { ...state.snapshot, maps };
         states.publish(state.snapshot);
      }
      await syncSharedFolder(input.request.installId);

      return Result.ok<DeleteSelectionOutcome, Problem>({ ...deleted.value, mapCount: selected.maps.length });
   }

   async function findMapsByHash(installId: InstallId, hashes: Iterable<MapHash>) {
      const snapshot = await list({ installId });
      const wanted = new Set(hashes);

      return snapshot.maps.filter((map) => map.hash && wanted.has(map.hash));
   }

   function search(request: MapSearchRequest) {
      return searchBeatSaver(catalog, request, () => installedHashes(request.installId));
   }

   async function lookup(key: string) {
      const record = await catalog.getByKey(key);

      return Result.isError(record) ? null : record.value.summary;
   }

   async function startDownload(request: MapDownloadRequest): Promise<MapOperationResult> {
      const record = await catalog.getByKey(request.source.key);
      if (Result.isError(record)) return mapFailure(request.installId, 'source-unavailable', record.error.detail);

      const mapsPath = await ensureMapsPath(request.installId);
      if (!mapsPath) return mapFailure(request.installId, 'install-not-found');

      const operation = options.operations.start(
         {
            kind: 'download',
            title: translate('maps.operations.download', { title: record.value.summary.title }),
            message: record.value.summary.mapper,
            progress: {
               phase: 'preparing',
               current: 0,
               total: 100,
               percent: 0,
               unit: 'items'
            },
            metadata: { installId: request.installId, key: record.value.summary.key }
         },
         (operationId, signal) =>
            runInstall(operationId, {
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
               signal
            })
      );

      return { ok: true, value: operation };
   }

   async function startDownloadByHash(input: {
      installId: InstallId;
      hashes: MapHash[];
      title: string;
      message?: string;
   }): Promise<MapOperationResult> {
      const mapsPath = await ensureMapsPath(input.installId);
      if (!mapsPath) return mapFailure(input.installId, 'install-not-found');

      const installed = await installedHashes(input.installId);
      const wanted = input.hashes.filter((hash) => !installed.has(hash));
      if (wanted.length === 0) return mapFailure(input.installId, 'already-installed');

      const records = await catalog.getByHashes(wanted);
      if (Result.isError(records)) return mapFailure(input.installId, 'source-unavailable', records.error.detail);
      if (records.value.size === 0) return mapFailure(input.installId, 'source-unavailable');

      const sources: MapArchiveSource[] = [...records.value.values()].map((record) => ({
         source: { kind: 'url', url: record.downloadUrl },
         fallbackName: record.summary.key,
         expectedHash: record.summary.hash
      }));
      const operationInput: Omit<CreateOperationInput, 'cancel'> = {
         kind: 'download',
         title: input.title,
         progress: {
            phase: 'preparing',
            current: 0,
            total: sources.length,
            percent: 0,
            unit: 'items'
         },
         metadata: { installId: input.installId, mapCount: sources.length }
      };
      if (input.message) operationInput.message = input.message;
      const operation = options.operations.start(operationInput, (operationId, signal) =>
         runInstall(operationId, { installId: input.installId, mapsPath, sources, allowedHosts: beatSaverDownloadHosts, signal })
      );

      return { ok: true, value: operation };
   }

   async function startImport(request: MapImportRequest): Promise<MapOperationResult> {
      if (request.paths.length === 0) return mapFailure(request.installId, 'no-source');

      const mapsPath = await ensureMapsPath(request.installId);
      if (!mapsPath) return mapFailure(request.installId, 'install-not-found');

      const operation = options.operations.start(
         {
            kind: 'import',
            title: translate('maps.operations.import', { count: request.paths.length }),
            message: mapsPath,
            progress: {
               phase: 'preparing',
               current: 0,
               total: request.paths.length,
               percent: 0,
               unit: 'items'
            },
            metadata: { installId: request.installId }
         },
         (operationId, signal) =>
            runInstall(operationId, {
               installId: request.installId,
               mapsPath,
               sources: request.paths.map((path) => ({
                  source: { kind: 'file', path },
                  fallbackName: basename(path, '.zip')
               })),
               signal
            })
      );

      return { ok: true, value: operation };
   }

   async function runInstall(
      operationId: string,
      input: Omit<InstallMapArchivesInput, 'ingestion' | 'installed' | 'onProgress'> & { installId: InstallId }
   ) {
      const unsubscribe = states.subscribe((snapshot) => {
         if (input.signal.aborted || snapshot.installId !== input.installId || !snapshot.progress) return;

         const { scanned, total } = snapshot.progress;
         options.operations.update(operationId, {
            progress: { phase: 'scanning', current: scanned, total, percent: total ? Math.round((scanned / total) * 100) : 0, unit: 'items' }
         });
      });
      const installed = await installedHashes(input.installId).finally(unsubscribe);
      if (input.signal.aborted) return;

      const outcome = await installMapArchives({
         ...input,
         ingestion,
         installed,
         onProgress: (index, progress) => reportInstallProgress(operationId, index, input.sources.length, progress)
      });

      await rescan({ installId: input.installId });
      await syncSharedFolder(input.installId);

      if (outcome.mapCount === 0) {
         options.operations.fail(operationId, outcome.lastProblem ?? createProblem('maps.nothing-installed'));
         return;
      }

      options.operations.complete(operationId, {
         installId: input.installId,
         mapCount: outcome.mapCount,
         bytes: outcome.bytes,
         files: outcome.files
      });
   }

   async function startExport(request: MapExportRequest): Promise<MapOperationResult> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return mapFailure(request.installId, selected.issue);

      const totalBytes = selected.maps.reduce((total, map) => total + map.sizeBytes, 0);
      const operation = options.operations.start(
         {
            kind: 'copy',
            title: translate('maps.export', { count: selected.maps.length }),
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
         (operationId, signal) => runExport(operationId, request, selected.maps, signal)
      );

      return { ok: true, value: operation };
   }

   async function runExport(operationId: string, request: MapExportRequest, maps: LocalMapSummary[], signal: AbortSignal) {
      const exported = await exportMapsToZip({
         maps,
         destinationPath: request.destinationPath,
         signal,
         onProgress: (progress) => options.operations.update(operationId, { progress })
      });

      if (Result.isError(exported)) return options.operations.fail(operationId, exported.error);

      options.operations.complete(operationId, {
         installId: request.installId,
         mapCount: exported.value.mapCount,
         bytes: exported.value.bytes,
         files: exported.value.files
      });
   }

   async function exportArchive(request: MapDetailRequest): Promise<Result<AsyncIterable<Uint8Array>, TargetUploadFailure>> {
      const mapPath = await getMapPath(request);
      if (!mapPath) return Result.err({ kind: 'not-found', ...createProblem('maps.not-found') });

      const archive = await openMapArchive(mapPath);
      return archive.mapError((problem): TargetUploadFailure => ({ kind: 'unavailable', ...problem }));
   }

   async function importArchive(request: MapCollectionRequest, source: AsyncIterable<Uint8Array>): Promise<Result<void, TargetUploadFailure>> {
      const mapsPath = await ensureMapsPath(request.installId);
      if (!mapsPath) return Result.err({ kind: 'not-found', ...createProblem('maps.install-not-found') });

      const received = await receiveMapArchive(ingestion.staging, source);
      if (Result.isError(received)) return Result.err(received.error);

      const outcome = await installMapArchives({
         ingestion,
         mapsPath,
         sources: [{ source: { kind: 'file', path: received.value.archivePath }, fallbackName: 'map' }],
         installed: await installedHashes(request.installId),
         signal: new AbortController().signal,
         onProgress: () => {}
      });
      await received.value.dispose();
      await rescan(request);
      await syncSharedFolder(request.installId);

      const problem = outcome.mapCount === 0 ? outcome.lastProblem : null;
      return problem && problem.code !== 'maps.already-installed' ? Result.err({ kind: 'invalid', ...problem }) : Result.ok(undefined);
   }

   async function ensureMapsPath(installId: InstallId) {
      const install = await options.registry.get(installId);

      return install ? ensureContentFolder(customLevelsPath(install.path)) : null;
   }

   async function syncSharedFolder(installId: InstallId) {
      const source = states.get(installId);
      const folder = source?.snapshot.mapsPath ? await resolveFolder(source.snapshot.mapsPath) : null;
      if (!source || !folder) return;

      const existing = sharedScans.get(folder);
      if (!existing?.pending) sharedScans.set(folder, { pending: null, cache: source.cache });

      for (const install of (await options.registry.list()).installs) {
         const state = install.id === installId ? undefined : states.get(install.id);
         const mapsPath = state?.snapshot.mapsPath;
         if (!state || state.pending || !mapsPath || (await resolveFolder(mapsPath)) !== folder) continue;

         state.cache = rebaseMapCache(source.cache, mapsPath);
         state.snapshot = { ...rebaseMapScan(source.snapshot, mapsPath), installId: install.id };
         states.publish(state.snapshot);
      }
   }

   async function installedHashes(installId: InstallId) {
      const snapshot = await list({ installId });

      return new Set(snapshot.maps.flatMap((map) => (map.hash ? [map.hash] : [])));
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

   function dispose() {
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
      exportArchive,
      importArchive,
      subscribe: states.subscribe,
      dispose
   };
}

async function resolveFolder(path: string) {
   const resolved = await Result.tryPromise(() => realpath(path));
   return Result.isOk(resolved) ? resolved.value : null;
}

function rebaseMapScan<Scan extends { maps: LocalMapSummary[] }>(scanned: Scan, mapsPath: string) {
   return {
      ...scanned,
      mapsPath,
      maps: scanned.maps.map((map) => ({ ...map, path: join(mapsPath, map.folderName) }))
   };
}

function rebaseMapCache(cache: Map<string, MapScanCacheEntry>, mapsPath: string) {
   return new Map([...cache].map(([folderName, entry]) => [folderName, { ...entry, map: { ...entry.map, path: join(mapsPath, folderName) } }]));
}
