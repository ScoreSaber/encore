import { Result } from 'better-result';
import { z } from 'zod';

import type { IpcFailureResult } from '@/ipc/core';
import { downloadContent } from '@/lib/content/content-download';
import type { ContentLimits } from '@/lib/content/content-limits';
import type { ContentStaging } from '@/lib/content/content-staging';
import { deleteManagedEntries, ensureContentFolder, isManagedPath, resolveManagedEntries } from '@/lib/content/managed-selection';
import { createScanStates, pruneScanCache, type ScanRequest } from '@/lib/content/scan-states';
import { createProblem } from '@/lib/errors';
import { getDirectorySize, scanInBatches } from '@/lib/filesystem/scan';
import { translate } from '@/lib/messages';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { MapHash, MapOperationResult } from '@/modules/maps/contract';
import type { MapService } from '@/modules/maps/main/map-service';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress } from '@/modules/operations/main/operation-reporting';
import {
   createEmptyPlaylistCollectionSnapshot,
   invalidPlaylistAction,
   localPlaylistSummarySchema,
   playlistCollectionSnapshotSchema,
   type LocalPlaylistSummary,
   type PlaylistActionIssue,
   type PlaylistCollectionRequest,
   type PlaylistCollectionSnapshot,
   type PlaylistDeletePreview,
   type PlaylistDeleteRequest,
   type PlaylistDetail,
   type PlaylistDetailRequest,
   type PlaylistDownloadRequest,
   type PlaylistExportRequest,
   type PlaylistImportRequest,
   type PlaylistOperationResult,
   type PlaylistProblem,
   type PlaylistSelectionRequest
} from '@/modules/playlists/contract';
import { installPlaylist, maxPlaylistBytes, parsePlaylistDocument, readPlaylistSource } from '@/modules/playlists/main/playlist-file';
import { playlistsPath } from '@/modules/playlists/main/playlist-paths';
import { scanPlaylists, type PlaylistRecord, type PlaylistScanCacheEntry } from '@/modules/playlists/main/playlist-scanner';
import { exportPlaylists } from '@/modules/playlists/main/playlist-storage';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

function failure(installId: InstallId, issue: PlaylistActionIssue, detail?: string): IpcFailureResult {
   return { ok: false, error: createProblem(`playlists.${issue}`, { installId, detail }) };
}

const playlistContentLimits: Partial<ContentLimits> = {
   maxDownloadBytes: maxPlaylistBytes,
   requestTimeoutMs: 20_000,
   stallTimeoutMs: 20_000
};

const playlistRecordSchema = z.object({ summary: localPlaylistSummarySchema, hashes: z.array(z.string()) });
const playlistScanCacheEntrySchema = z.object({ fingerprint: z.string(), record: playlistRecordSchema });

type PlaylistServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   maps: MapService;
   dataPath: string;
   log: AppLogWriter;
   staging: ContentStaging;
};

type ResolvedSelection = { status: 'invalid'; issue: PlaylistActionIssue } | { status: 'ok'; playlistsPath: string; records: PlaylistRecord[] };

type ReadyDeletePreview = Extract<PlaylistDeletePreview, { status: 'ok' }>;
export type PlaylistService = ReturnType<typeof createPlaylistService>;

export function createPlaylistService(options: PlaylistServiceOptions) {
   const reportDeleteProgress = createBytesProgress(options.operations);
   const missingGenerations = new Map<InstallId, number>();
   const deferredMissingRefreshes = new Set<InstallId>();
   let disposed = false;
   const isDisposed = () => disposed;
   const states = createScanStates({
      dataPath: options.dataPath,
      log: options.log,
      cacheName: 'playlists',
      snapshotSchema: playlistCollectionSnapshotSchema,
      cacheEntrySchema: playlistScanCacheEntrySchema,
      extraSchema: z.array(playlistRecordSchema),
      emptyExtra: [],
      getInstallPath: async (installId) => (await options.registry.get(installId))?.path ?? null,
      emptySnapshot: (installId, status) => createEmptyPlaylistCollectionSnapshot({ installId }, status),
      runScan
   });
   const { list, rescan } = states;

   const unsubscribeMaps = options.maps.subscribe((snapshot) => {
      if (snapshot.status === 'scanning') return;

      void refreshMissing(snapshot.installId);
   });

   async function runScan({
      installId,
      installPath,
      state,
      onProgress
   }: ScanRequest<PlaylistCollectionSnapshot, PlaylistScanCacheEntry, PlaylistRecord[]>) {
      const scanned = await scanPlaylists({
         installPath,
         cache: state.cache,
         onProgress
      });

      pruneScanCache(state.cache, new Set(scanned.records.map((record) => record.summary.fileName)));

      state.extra = scanned.records;
      deferredMissingRefreshes.delete(installId);
      missingGenerations.set(installId, (missingGenerations.get(installId) ?? 0) + 1);
      state.snapshot = {
         installId,
         status: scanned.status,
         playlistsPath: scanned.playlistsPath,
         scannedAt: new Date().toISOString(),
         playlists: await describeRecords(installId, scanned.records),
         problems: scanned.problems,
         progress: null
      };

      if (deferredMissingRefreshes.delete(installId)) {
         state.snapshot = { ...state.snapshot, playlists: await describeRecords(installId, state.extra) };
      }

      return state.snapshot;
   }

   async function refreshMissing(installId: InstallId) {
      if (isDisposed()) return;
      const state = states.get(installId);
      if (!state) return;
      if (state.pending) {
         deferredMissingRefreshes.add(installId);
         return;
      }
      if (state.snapshot.status !== 'ready') return;

      const generation = (missingGenerations.get(installId) ?? 0) + 1;
      missingGenerations.set(installId, generation);
      const records = state.extra;
      const playlists = await describeRecords(installId, records);

      if (isDisposed() || missingGenerations.get(installId) !== generation) return;
      const current = states.get(installId);
      if (!current || current.pending || current.snapshot.status !== 'ready' || current.extra !== records) return;

      current.snapshot = { ...current.snapshot, playlists };
      states.publish(current.snapshot);
   }

   async function describeRecords(installId: InstallId, records: PlaylistRecord[]): Promise<LocalPlaylistSummary[]> {
      const installed = await installedHashes(installId);

      return records.map((record) => ({ ...record.summary, missingCount: countMissing(record, installed) }));
   }

   async function getDetail(request: PlaylistDetailRequest): Promise<PlaylistDetail | null> {
      const record = await locate(request.installId, request.playlistId);
      if (!record) return null;

      const installed = await installedHashes(request.installId);
      const songs = await readPlaylistSongs(record);
      if (Result.isError(songs)) {
         return {
            ...record.summary,
            problem: songs.error,
            missingCount: countMissing(record, installed),
            songs: []
         };
      }

      return {
         ...record.summary,
         missingCount: countMissing(record, installed),
         songs: songs.value.map((song) => ({ ...song, installed: song.hash !== null && installed.has(song.hash) }))
      };
   }

   async function getPlaylistsPath(request: PlaylistCollectionRequest) {
      const snapshot = await list(request);

      return snapshot.status === 'missing' ? null : snapshot.playlistsPath;
   }

   async function previewDelete(request: PlaylistDeleteRequest): Promise<PlaylistDeletePreview> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return invalidPlaylistAction(request, selected.issue);

      const sizeBytes = selected.records.reduce((total, record) => total + record.summary.sizeBytes, 0);
      const maps = request.deleteMaps ? await options.maps.findMapsByHash(request.installId, collectHashes(selected.records)) : [];
      const sizes = await scanInBatches(maps, {}, (map) => getDirectorySize(map.path));

      let mapSizeBytes = 0;
      for (const size of sizes) {
         if (Result.isError(size)) return invalidPlaylistAction(request, 'inspect-failed', size.error.detail);

         mapSizeBytes += size.value.bytes;
      }

      return {
         status: 'ok',
         installId: request.installId,
         playlistsPath: selected.playlistsPath,
         names: selected.records.map((record) => record.summary.title || record.summary.fileName),
         playlistCount: selected.records.length,
         sizeBytes,
         deleteMaps: request.deleteMaps ?? false,
         mapNames: maps.map((map) => map.title || map.folderName),
         mapCount: maps.length,
         mapSizeBytes
      };
   }

   async function startDelete(request: PlaylistDeleteRequest): Promise<PlaylistOperationResult> {
      const previewed = await previewDelete(request);
      if (previewed.status === 'invalid') return failure(request.installId, previewed.issue, previewed.detail);

      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const operation = options.operations.start(
         {
            kind: 'delete',
            title: translate('playlists.actions.delete.action', { count: previewed.playlistCount }),
            message: previewed.playlistsPath,
            progress: { phase: 'preparing', current: 0, total: previewed.sizeBytes + previewed.mapSizeBytes, percent: 0, unit: 'bytes' },
            metadata: { installId: request.installId, playlistsPath: previewed.playlistsPath, deleteMaps: previewed.deleteMaps }
         },
         (operationId, signal) => runDelete(operationId, request, previewed, selected.records, signal)
      );

      return { ok: true, value: operation };
   }

   async function runDelete(
      operationId: string,
      request: PlaylistDeleteRequest,
      previewed: ReadyDeletePreview,
      records: PlaylistRecord[],
      signal: AbortSignal
   ) {
      const totalBytes = previewed.sizeBytes + previewed.mapSizeBytes;
      const deleted = await deleteManagedEntries(
         records.map((record) => ({
            path: record.summary.path,
            root: previewed.playlistsPath,
            label: record.summary.title || record.summary.fileName
         })),
         { signal, onProgress: (progress) => reportDeleteProgress(operationId, 'deleting', progress.bytes, totalBytes, progress.label) }
      );
      if (Result.isError(deleted)) {
         await rescan(request);
         return options.operations.fail(operationId, deleted.error);
      }

      let { bytes, files } = deleted.value;

      if (previewed.deleteMaps && previewed.mapCount > 0) {
         const maps = await options.maps.findMapsByHash(request.installId, collectHashes(records));
         const playlistBytes = bytes;
         const deletedMaps = await options.maps.deleteSelection({
            request: { installId: request.installId, mapIds: maps.map((map) => map.id) },
            signal,
            onProgress: (progress) => reportDeleteProgress(operationId, 'deleting', playlistBytes + progress.bytes, totalBytes, progress.label)
         });

         if (Result.isError(deletedMaps)) {
            await rescan(request);
            return options.operations.fail(operationId, deletedMaps.error);
         }

         bytes += deletedMaps.value.bytes;
         files += deletedMaps.value.files;
      }

      await rescan(request);

      options.operations.complete(operationId, {
         installId: request.installId,
         playlistCount: records.length,
         bytes,
         files
      });
   }

   async function startImport(request: PlaylistImportRequest): Promise<PlaylistOperationResult> {
      if (request.paths.length === 0) return failure(request.installId, 'no-source');

      const rootPath = await ensurePlaylistsPath(request.installId);
      if (!rootPath) return failure(request.installId, 'install-not-found');

      const operation = options.operations.start(
         {
            kind: 'import',
            title: translate('playlists.operations.import', { count: request.paths.length }),
            message: rootPath,
            progress: { phase: 'preparing', current: 0, total: request.paths.length, percent: 0, unit: 'items' },
            metadata: { installId: request.installId }
         },
         (operationId, signal) => runImport(operationId, request, rootPath, signal)
      );

      return { ok: true, value: operation };
   }

   async function runImport(operationId: string, request: PlaylistImportRequest, rootPath: string, signal: AbortSignal) {
      let bytes = 0;
      let playlistCount = 0;
      let lastProblem: PlaylistProblem | null = null;

      for (const [index, path] of request.paths.entries()) {
         if (signal.aborted) break;

         const fileName = basename(path);
         options.operations.update(operationId, {
            progress: {
               phase: 'importing',
               current: index,
               total: request.paths.length,
               percent: Math.round((index / request.paths.length) * 100),
               unit: 'items',
               label: fileName
            }
         });

         const content = await readPlaylistSource(path);
         if (Result.isError(content)) {
            lastProblem = content.error;
            continue;
         }

         const installed = await installPlaylist(rootPath, content.value.bytes, content.value.title, fileName);
         if (Result.isError(installed)) {
            lastProblem = installed.error;
            continue;
         }

         bytes += installed.value;
         playlistCount += 1;
      }

      await finishWrite(operationId, request.installId, playlistCount, bytes, lastProblem);
   }

   async function startDownload(request: PlaylistDownloadRequest): Promise<PlaylistOperationResult> {
      const rootPath = await ensurePlaylistsPath(request.installId);
      if (!rootPath) return failure(request.installId, 'install-not-found');

      const operation = options.operations.start(
         {
            kind: 'download',
            title: translate('playlists.add.action'),
            message: request.url,
            progress: { phase: 'preparing', current: 0, total: 1, percent: 0, unit: 'items' },
            metadata: { installId: request.installId }
         },
         (operationId, signal) => runDownload(operationId, request, rootPath, signal)
      );

      return { ok: true, value: operation };
   }

   async function runDownload(operationId: string, request: PlaylistDownloadRequest, rootPath: string, signal: AbortSignal) {
      const area = await options.staging.create('playlist');
      if (Result.isError(area)) {
         options.operations.fail(operationId, area.error);
         return;
      }

      try {
         const downloaded = await downloadContent({
            url: request.url,
            destinationPath: join(area.value.path, 'playlist.json'),
            limits: playlistContentLimits,
            signal,
            onProgress: (progress) => options.operations.update(operationId, { progress })
         });
         if (Result.isError(downloaded)) {
            options.operations.fail(operationId, downloaded.error);
            return;
         }

         const fallbackName = downloaded.value.fileName ?? 'playlist';
         const content = await readPlaylistSource(downloaded.value.path, fallbackName);
         if (Result.isError(content)) {
            await finishWrite(operationId, request.installId, 0, 0, content.error);
            return;
         }

         const installed = await installPlaylist(rootPath, content.value.bytes, content.value.title, fallbackName);
         if (Result.isError(installed)) {
            await finishWrite(operationId, request.installId, 0, 0, installed.error);
            return;
         }

         await finishWrite(operationId, request.installId, 1, installed.value, null);
      } finally {
         await area.value.dispose();
      }
   }

   async function startInstallMissing(request: PlaylistDetailRequest): Promise<MapOperationResult> {
      const record = await locate(request.installId, request.playlistId);
      if (!record) return failure(request.installId, 'not-found');

      const installed = await installedHashes(request.installId);
      const missing = [...new Set(record.hashes.filter((hash) => !installed.has(hash)))];
      if (missing.length === 0) return failure(request.installId, 'no-missing-maps');

      return options.maps.startDownloadByHash({
         installId: request.installId,
         hashes: missing,
         title: translate('playlists.detail.installMissing', { count: missing.length }),
         message: record.summary.title
      });
   }

   async function startExport(request: PlaylistExportRequest): Promise<PlaylistOperationResult> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const totalBytes = selected.records.reduce((total, record) => total + record.summary.sizeBytes, 0);
      const operation = options.operations.start(
         {
            kind: 'copy',
            title: translate('playlists.export', { count: selected.records.length }),
            message: request.destinationPath,
            progress: { phase: 'preparing', current: 0, total: totalBytes, percent: 0, unit: 'bytes' },
            metadata: { installId: request.installId, destinationPath: request.destinationPath }
         },
         (operationId, signal) => runExport(operationId, request, selected.records, signal)
      );

      return { ok: true, value: operation };
   }

   async function runExport(operationId: string, request: PlaylistExportRequest, records: PlaylistRecord[], signal: AbortSignal) {
      const exported = await exportPlaylists({
         playlists: records.map((record) => record.summary),
         destinationPath: request.destinationPath,
         signal,
         onProgress: (progress) => options.operations.update(operationId, { progress })
      });

      if (Result.isError(exported)) return options.operations.fail(operationId, exported.error);

      options.operations.complete(operationId, {
         installId: request.installId,
         playlistCount: exported.value.playlistCount,
         bytes: exported.value.bytes,
         files: exported.value.files
      });
   }

   async function finishWrite(operationId: string, installId: InstallId, playlistCount: number, bytes: number, problem: PlaylistProblem | null) {
      await rescan({ installId });

      if (playlistCount === 0) {
         options.operations.fail(operationId, problem ?? createProblem('playlists.nothing-installed'));
         return;
      }

      options.operations.complete(operationId, {
         installId,
         playlistCount,
         bytes,
         files: playlistCount
      });
   }

   async function ensurePlaylistsPath(installId: InstallId) {
      const snapshot = await list({ installId });
      if (snapshot.playlistsPath && snapshot.status !== 'missing') return snapshot.playlistsPath;

      const install = await options.registry.get(installId);

      return install ? ensureContentFolder(playlistsPath(install.path)) : null;
   }

   async function installedHashes(installId: InstallId) {
      const snapshot = await options.maps.list({ installId });

      return new Set(snapshot.maps.flatMap((map) => (map.hash ? [map.hash] : [])));
   }

   function countMissing(record: PlaylistRecord, installed: Set<MapHash>) {
      return record.hashes.filter((hash) => !installed.has(hash)).length;
   }

   function collectHashes(records: PlaylistRecord[]) {
      return new Set(records.flatMap((record) => record.hashes));
   }

   async function readPlaylistSongs(record: PlaylistRecord) {
      const raw = await Result.tryPromise({
         try: () => readFile(record.summary.path, 'utf8'),
         catch: (cause) => createProblem('playlists.file.unreadable', { fileName: record.summary.fileName, cause })
      });
      if (Result.isError(raw)) return Result.err(raw.error);

      return Result.map(parsePlaylistDocument(raw.value, record.summary.fileName), (document) => document.songs);
   }

   async function resolveSelection(request: PlaylistSelectionRequest): Promise<ResolvedSelection> {
      if (request.playlistIds.length === 0) return { status: 'invalid', issue: 'no-selection' };

      const state = await readState(request.installId);
      const rootPath = state.snapshot.playlistsPath;
      if (!rootPath || state.snapshot.status === 'missing') return { status: 'invalid', issue: 'playlists-missing' };

      const resolved = await resolveManagedEntries({
         ids: request.playlistIds,
         entries: state.records,
         idOf: (record) => record.summary.id,
         pathOf: (record) => record.summary.path,
         rootOf: () => rootPath
      });

      return resolved.status === 'invalid' ? resolved : { status: 'ok', playlistsPath: rootPath, records: resolved.entries };
   }

   async function locate(installId: InstallId, playlistId: string) {
      const state = await readState(installId);
      const record = state.records.find((entry) => entry.summary.id === playlistId);
      if (!record || !state.snapshot.playlistsPath) return null;

      return (await isManagedPath(state.snapshot.playlistsPath, record.summary.path)) ? record : null;
   }

   async function readState(installId: InstallId) {
      const snapshot = await list({ installId });

      return { snapshot, records: states.get(installId)?.extra ?? [] };
   }

   function dispose() {
      disposed = true;
      unsubscribeMaps();
      missingGenerations.clear();
      deferredMissingRefreshes.clear();
      states.dispose();
   }

   return {
      list,
      rescan,
      getDetail,
      getPlaylistsPath,
      previewDelete,
      startDelete,
      startImport,
      startDownload,
      startInstallMissing,
      startExport,
      subscribe: states.subscribe,
      dispose
   };
}
