import { Result } from 'better-result';
import { z } from 'zod';

import { createContentScanCache } from '@/lib/content/content-cache';
import { downloadContent, type ContentFetch } from '@/lib/content/content-download';
import { createContentFailure, createOperationFailure } from '@/lib/content/content-errors';
import { createContentEvents } from '@/lib/content/content-events';
import type { ContentLimits } from '@/lib/content/content-limits';
import { createContentStaging, type ContentStaging } from '@/lib/content/content-staging';
import { ensureContentFolder, isManagedPath, resolveManagedEntries } from '@/lib/content/managed-selection';
import { createScanStates, pruneScanCache, type ContentScanState } from '@/lib/content/scan-states';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import { createUniquePath, resolveManagedPath } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import { scanInBatches } from '@/lib/filesystem/scan';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { MapHash, MapOperationResult } from '@/modules/maps/contract';
import type { MapService } from '@/modules/maps/main/map-service';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { createBytesProgress } from '@/modules/operations/main/progress';
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
   type PlaylistSelectionRequest,
   type PlaylistSongRef
} from '@/modules/playlists/contract';
import { maxPlaylistBytes, parsePlaylistDocument } from '@/modules/playlists/main/playlist-file';
import { isPlaylistFileName, playlistsPath, toSafePlaylistFileName } from '@/modules/playlists/main/playlist-paths';
import { createPlaylistProblem, type PlaylistResult } from '@/modules/playlists/main/playlist-problem';
import { scanPlaylists, type PlaylistRecord, type PlaylistScanCacheEntry } from '@/modules/playlists/main/playlist-scanner';
import { exportPlaylists, writePlaylistFile } from '@/modules/playlists/main/playlist-storage';

import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const actionIssueMessages: Record<PlaylistActionIssue, string> = {
   'install-not-found': 'the install is not in the registry anymore',
   'inspect-failed': 'the playlist could not be inspected',
   'invalid-source': 'that address does not point at a playlist',
   'no-missing-maps': 'every map in this playlist is already installed',
   'no-selection': 'no playlists were selected',
   'no-source': 'no playlist file was chosen',
   'not-found': 'the playlist is not in this install anymore',
   'playlists-missing': 'this install has no playlists folder yet',
   'source-unavailable': 'the playlist could not be downloaded',
   'unsupported-target': 'this target cannot manage playlists'
};

const playlistContentLimits: Partial<ContentLimits> = {
   maxDownloadBytes: maxPlaylistBytes,
   requestTimeoutMs: 20_000,
   stallTimeoutMs: 20_000
};

const maxMissingMapsPerRun = 200;
const playlistRecordSchema = z.object({ summary: localPlaylistSummarySchema, hashes: z.array(z.string()) });
const playlistScanCacheEntrySchema = z.object({ fingerprint: z.string(), record: playlistRecordSchema });

type PlaylistServiceOptions = {
   registry: InstallRegistry;
   operations: OperationRegistry;
   maps: MapService;
   dataPath: string;
   staging?: ContentStaging;
   fetchContent?: ContentFetch;
};

type PlaylistScanState = ContentScanState<PlaylistCollectionSnapshot, PlaylistScanCacheEntry, PlaylistRecord[]>;

type ResolvedSelection = { status: 'invalid'; issue: PlaylistActionIssue } | { status: 'ok'; playlistsPath: string; records: PlaylistRecord[] };

type ReadyDeletePreview = Extract<PlaylistDeletePreview, { status: 'ok' }>;
export type PlaylistService = ReturnType<typeof createPlaylistService>;

export function createPlaylistService(options: PlaylistServiceOptions) {
   const staging = options.staging ?? createContentStaging({ dataPath: options.dataPath });
   const events = createContentEvents<PlaylistCollectionSnapshot>();
   const invalid = (installId: InstallId, issue: PlaylistActionIssue, detail?: string) => invalidPlaylistAction({ installId }, issue, detail);
   const failure = createContentFailure<PlaylistActionIssue>('playlists', actionIssueMessages);
   const failOperation = createOperationFailure(options.operations);
   const reportDeleteProgress = createBytesProgress(options.operations);
   const states = createScanStates<PlaylistCollectionSnapshot, PlaylistScanCacheEntry, PlaylistRecord[]>({
      getInstallPath: async (installId) => (await options.registry.get(installId))?.path ?? null,
      emptySnapshot: (installId, status) => createEmptyPlaylistCollectionSnapshot({ installId }, status),
      emptyExtra: () => [],
      runScan,
      publish: events.publish,
      cache: createContentScanCache({
         dataPath: options.dataPath,
         name: 'playlists',
         snapshotSchema: playlistCollectionSnapshotSchema,
         cacheEntrySchema: playlistScanCacheEntrySchema,
         extraSchema: z.array(playlistRecordSchema)
      })
   });
   const listState = states.list;
   const rescanState = states.rescan;

   function list(input: PlaylistCollectionRequest) {
      return listState(input.installId);
   }

   function rescan(input: PlaylistCollectionRequest) {
      return rescanState(input.installId);
   }

   const unsubscribeMaps = options.maps.subscribe((snapshot) => {
      if (snapshot.status === 'scanning') return;

      void refreshMissing(snapshot.installId);
   });

   async function runScan({ installId, installPath, state }: { installId: InstallId; installPath: string; state: PlaylistScanState }) {
      const scanned = await scanPlaylists({
         installPath,
         cache: state.cache,
         onProgress: (progress) => {
            state.snapshot = { ...state.snapshot, status: 'scanning', progress };
            if (!state.background) events.publish(state.snapshot);
         }
      });

      pruneScanCache(state.cache, new Set(scanned.records.map((record) => record.summary.fileName)));

      state.extra = scanned.records;
      state.snapshot = {
         installId,
         status: scanned.status,
         playlistsPath: scanned.playlistsPath,
         scannedAt: new Date().toISOString(),
         playlists: await describeRecords(installId, scanned.records),
         problems: scanned.problems,
         progress: null
      };

      return state.snapshot;
   }

   async function refreshMissing(installId: InstallId) {
      const state = states.get(installId);
      if (!state || state.pending || state.snapshot.status !== 'ready') return;

      state.snapshot = { ...state.snapshot, playlists: await describeRecords(installId, state.extra) };
      events.publish(state.snapshot);
   }

   async function describeRecords(installId: InstallId, records: PlaylistRecord[]): Promise<LocalPlaylistSummary[]> {
      const installed = await installedHashes(installId);

      return records.map((record) => ({ ...record.summary, missingCount: countMissing(record, installed) }));
   }

   async function getDetail(request: PlaylistDetailRequest): Promise<PlaylistDetail | null> {
      const located = await locate(request.installId, request.playlistId);
      if (!located) return null;

      const installed = await installedHashes(request.installId);
      const songs = await readPlaylistSongs(located.record);
      if (Result.isError(songs)) {
         return {
            ...located.record.summary,
            problem: songs.error,
            missingCount: countMissing(located.record, installed),
            songs: []
         };
      }

      return {
         ...located.record.summary,
         missingCount: countMissing(located.record, installed),
         songs: songs.value.map((song) => ({ ...song, installed: song.hash !== null && installed.has(song.hash) }))
      };
   }

   async function getPlaylistsPath(request: PlaylistCollectionRequest) {
      const snapshot = await list(request);

      return snapshot.status === 'missing' ? null : snapshot.playlistsPath;
   }

   async function previewDelete(request: PlaylistDeleteRequest): Promise<PlaylistDeletePreview> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return invalid(request.installId, selected.issue);

      const sizeBytes = selected.records.reduce((total, record) => total + record.summary.sizeBytes, 0);
      const maps = request.deleteMaps ? await options.maps.findMapsByHash(request.installId, collectHashes(selected.records)) : [];
      const sizes = await scanInBatches(maps, {}, (map) => getDirectorySize(map.path));

      let mapSizeBytes = 0;
      for (const size of sizes) {
         if (Result.isError(size)) return invalid(request.installId, 'inspect-failed', size.error.detail);

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

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'delete',
         title: `Delete ${previewed.playlistCount} ${previewed.playlistCount === 1 ? 'playlist' : 'playlists'}`,
         message: previewed.playlistsPath,
         progress: { phase: 'preparing', current: 0, total: previewed.sizeBytes + previewed.mapSizeBytes, percent: 0, unit: 'bytes' },
         metadata: { installId: request.installId, playlistsPath: previewed.playlistsPath, deleteMaps: previewed.deleteMaps },
         cancel: () => controller.abort()
      });

      void runDelete(operation.id, request, previewed, selected.records, controller.signal);

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
      let bytes = 0;
      let files = 0;

      for (const record of records) {
         const deleted = await deletePathWithProgress({
            targetPath: record.summary.path,
            root: previewed.playlistsPath,
            allowMissing: true,
            scope: 'content',
            signal,
            onProgress: (progress) =>
               reportDeleteProgress(
                  operationId,
                  'deleting',
                  bytes + (progress.current ?? 0),
                  totalBytes,
                  record.summary.title || record.summary.fileName
               )
         });

         if (Result.isError(deleted)) {
            await rescan(request);
            return failOperation(operationId, deleted.error);
         }

         bytes += deleted.value.bytes;
         files += deleted.value.files;
      }

      if (previewed.deleteMaps && previewed.mapCount > 0) {
         const maps = await options.maps.findMapsByHash(request.installId, collectHashes(records));
         const playlistBytes = bytes;
         const deleted = await options.maps.deleteSelection({
            request: { installId: request.installId, mapIds: maps.map((map) => map.id) },
            signal,
            onProgress: (progress) => reportDeleteProgress(operationId, 'deleting', playlistBytes + progress.bytes, totalBytes, progress.label)
         });

         if (Result.isError(deleted)) {
            await rescan(request);
            return failOperation(operationId, deleted.error);
         }

         bytes += deleted.value.bytes;
         files += deleted.value.files;
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

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'import',
         title: `Import ${request.paths.length} ${request.paths.length === 1 ? 'playlist' : 'playlists'}`,
         message: rootPath,
         progress: { phase: 'preparing', current: 0, total: request.paths.length, percent: 0, unit: 'items' },
         metadata: { installId: request.installId },
         cancel: () => controller.abort()
      });

      void runImport(operation.id, request, rootPath, controller.signal);

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

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: 'Add playlist',
         message: request.url,
         progress: { phase: 'preparing', current: 0, total: 1, percent: 0, unit: 'items' },
         metadata: { installId: request.installId },
         cancel: () => controller.abort()
      });

      void runDownload(operation.id, request, rootPath, controller.signal);

      return { ok: true, value: operation };
   }

   async function runDownload(operationId: string, request: PlaylistDownloadRequest, rootPath: string, signal: AbortSignal) {
      const area = await staging.create('playlist');
      if (Result.isError(area)) {
         options.operations.fail(operationId, { code: area.error.code, message: area.error.message, details: { detail: area.error.detail } });
         return;
      }

      try {
         const downloaded = await downloadContent({
            url: request.url,
            destinationPath: join(area.value.path, 'playlist.json'),
            limits: playlistContentLimits,
            signal,
            ...(options.fetchContent ? { fetchContent: options.fetchContent } : {}),
            onProgress: (progress) => options.operations.update(operationId, { progress })
         });
         if (Result.isError(downloaded)) {
            options.operations.fail(operationId, {
               code: downloaded.error.code,
               message: downloaded.error.message,
               details: { detail: downloaded.error.detail }
            });
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
      const located = await locate(request.installId, request.playlistId);
      if (!located) return failure(request.installId, 'not-found');

      const installed = await installedHashes(request.installId);
      const missing = [...new Set(located.record.hashes.filter((hash) => !installed.has(hash)))];
      if (missing.length === 0) return failure(request.installId, 'no-missing-maps');

      return options.maps.startDownloadByHash({
         installId: request.installId,
         hashes: missing.slice(0, maxMissingMapsPerRun),
         title: `Install ${missing.length} missing ${missing.length === 1 ? 'map' : 'maps'}`,
         message: located.record.summary.title
      });
   }

   async function startExport(request: PlaylistExportRequest): Promise<PlaylistOperationResult> {
      const selected = await resolveSelection(request);
      if (selected.status === 'invalid') return failure(request.installId, selected.issue);

      const controller = new AbortController();
      const totalBytes = selected.records.reduce((total, record) => total + record.summary.sizeBytes, 0);
      const operation = options.operations.create({
         kind: 'copy',
         title: `Export ${selected.records.length} ${selected.records.length === 1 ? 'playlist' : 'playlists'}`,
         message: request.destinationPath,
         progress: { phase: 'preparing', current: 0, total: totalBytes, percent: 0, unit: 'bytes' },
         metadata: { installId: request.installId, destinationPath: request.destinationPath },
         cancel: () => controller.abort()
      });

      void runExport(operation.id, request, selected.records, controller.signal);

      return { ok: true, value: operation };
   }

   async function runExport(operationId: string, request: PlaylistExportRequest, records: PlaylistRecord[], signal: AbortSignal) {
      const exported = await exportPlaylists({
         playlists: records.map((record) => record.summary),
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
         playlistCount: exported.value.playlistCount,
         bytes: exported.value.bytes,
         files: exported.value.files
      });
   }

   async function readPlaylistSource(path: string, fallbackName?: string) {
      const fileName = fallbackName ?? basename(path);

      if (fallbackName === undefined && !isPlaylistFileName(fileName)) {
         return Result.err<{ bytes: Uint8Array; title: string }, PlaylistProblem>(
            createPlaylistProblem('playlists.file.invalid', 'this file is not a playlist', { fileName })
         );
      }

      const stats = await Result.tryPromise({
         try: () => stat(path),
         catch: (cause) => createPlaylistProblem('playlists.source.unreadable', 'this file could not be read', { fileName, cause })
      });
      if (Result.isError(stats)) return Result.err<{ bytes: Uint8Array; title: string }, PlaylistProblem>(stats.error);

      if (!stats.value.isFile() || stats.value.size > maxPlaylistBytes) {
         return Result.err<{ bytes: Uint8Array; title: string }, PlaylistProblem>(
            createPlaylistProblem('playlists.file.too-large', 'this file is too large to be a playlist', { fileName })
         );
      }

      const raw = await Result.tryPromise({
         try: () => readFile(path),
         catch: (cause) => createPlaylistProblem('playlists.source.unreadable', 'this file could not be read', { fileName, cause })
      });
      if (Result.isError(raw)) return Result.err<{ bytes: Uint8Array; title: string }, PlaylistProblem>(raw.error);

      const parsed = parsePlaylistDocument(raw.value.toString('utf8'), fileName);
      if (Result.isError(parsed)) return Result.err<{ bytes: Uint8Array; title: string }, PlaylistProblem>(parsed.error);

      return Result.ok<{ bytes: Uint8Array; title: string }, PlaylistProblem>({ bytes: new Uint8Array(raw.value), title: parsed.value.title });
   }

   async function installPlaylist(rootPath: string, bytes: Uint8Array, title: string, fallbackName: string) {
      const fallback = basename(fallbackName, extname(fallbackName)) || 'playlist';
      const desiredPath = join(rootPath, toSafePlaylistFileName(title || fallback, fallback));

      const unique = await createUniquePath(desiredPath);
      if (Result.isError(unique)) {
         return Result.err<number, PlaylistProblem>(createPlaylistProblem('playlists.write.failed', unique.error.message, { fileName: fallback }));
      }

      const managed = await resolveManagedPath({ root: rootPath, path: unique.value });
      if (Result.isError(managed)) {
         return Result.err<number, PlaylistProblem>(createPlaylistProblem('playlists.write.failed', managed.error.message, { fileName: fallback }));
      }

      return writePlaylistFile(managed.value.path, bytes);
   }

   async function finishWrite(operationId: string, installId: InstallId, playlistCount: number, bytes: number, problem: PlaylistProblem | null) {
      await rescan({ installId });

      if (playlistCount === 0) {
         const failed = problem ?? createPlaylistProblem('playlists.write.failed', 'no playlist was installed');
         options.operations.fail(operationId, { code: failed.code, message: failed.message, details: { detail: failed.detail } });
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

      return new Set(snapshot.maps.flatMap((map) => (map.hash ? [map.hash.toLowerCase()] : [])));
   }

   function countMissing(record: PlaylistRecord, installed: Set<MapHash>) {
      return record.hashes.filter((hash) => !installed.has(hash)).length;
   }

   function collectHashes(records: PlaylistRecord[]) {
      return new Set(records.flatMap((record) => record.hashes));
   }

   async function readPlaylistSongs(record: PlaylistRecord): Promise<PlaylistResult<PlaylistSongRef[]>> {
      const raw = await Result.tryPromise({
         try: () => readFile(record.summary.path, 'utf8'),
         catch: (cause) =>
            createPlaylistProblem('playlists.file.unreadable', 'this playlist could not be read', {
               fileName: record.summary.fileName,
               cause
            })
      });
      if (Result.isError(raw)) return Result.err<PlaylistSongRef[], PlaylistProblem>(raw.error);

      const parsed = parsePlaylistDocument(raw.value, record.summary.fileName);
      return Result.isError(parsed)
         ? Result.err<PlaylistSongRef[], PlaylistProblem>(parsed.error)
         : Result.ok<PlaylistSongRef[], PlaylistProblem>(parsed.value.songs);
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

      return (await isManagedPath(state.snapshot.playlistsPath, record.summary.path)) ? { snapshot: state.snapshot, record } : null;
   }

   async function readState(installId: InstallId) {
      const snapshot = await list({ installId });

      return { snapshot, records: states.get(installId)?.extra ?? [] };
   }

   function dispose() {
      unsubscribeMaps();
      events.dispose();
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
      subscribe: events.subscribe,
      dispose
   };
}
