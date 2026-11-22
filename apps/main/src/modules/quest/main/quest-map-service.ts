import { Result } from 'better-result';

import { quoteShellArg } from '@/lib/android/adb';
import type { TargetUploadFailure } from '@/lib/api';
import type { ContentIngestionService } from '@/lib/content/content-ingestion';
import { createProblem, type Problem } from '@/lib/errors';
import { isSafeFileName } from '@/lib/filesystem/path';
import { translate } from '@/lib/messages';
import {
   createEmptyMapCollectionSnapshot,
   invalidMapAction,
   type LocalMapSummary,
   type MapCollectionRequest,
   type MapCollectionSnapshot,
   type MapCoversRequest,
   type MapDeletePreview,
   type MapDetailRequest,
   type MapDownloadRequest,
   type MapSearchRequest,
   type MapSelectionRequest
} from '@/modules/maps/contract';
import {
   beatSaverDownloadHosts,
   createBeatSaverCatalog,
   searchBeatSaver,
   type BeatSaverCatalog,
   type BeatSaverMapRecord
} from '@/modules/maps/main/beatsaver-catalog';
import { openMapArchive } from '@/modules/maps/main/map-archive';
import { coverDataUrl, coverMimeType, maxCoverBytes, packCovers } from '@/modules/maps/main/map-covers';
import { parseMapInfo } from '@/modules/maps/main/map-info';
import { receiveMapArchive, stageMapArchive, type MapArchiveSource } from '@/modules/maps/main/map-install';
import { withMapDuplicateFlags } from '@/modules/maps/main/map-scanner';
import { mapFailure } from '@/modules/maps/main/map-service';
import type { OperationProgress } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { questInstallId } from '@/modules/quest/contract';
import type { QuestConnection, QuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestMapCache, questMapFolder, type QuestMapFolder } from '@/modules/quest/main/quest-map-cache';
import type { QuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { questMapsDir, questStagingDir } from '@/modules/quest/main/quest-paths';
import type { TargetId } from '@/modules/targets/contract';

import { randomUUID } from 'node:crypto';
import { join, posix } from 'node:path';

export function createQuestMapService(options: {
   devices: QuestDeviceService;
   operations: OperationRegistry;
   ingestion: ContentIngestionService;
   catalog?: BeatSaverCatalog;
   mutations: QuestMutationLock;
   dataPath: string;
}) {
   const catalog = options.catalog ?? createBeatSaverCatalog();
   const snapshots = new Map<TargetId, MapCollectionSnapshot>();
   const folders = new Map<TargetId, Map<string, QuestMapFolder>>();
   const stale = new Set<TargetId>();
   const cache = createQuestMapCache(options.dataPath);
   const scanning = new Map<TargetId, Promise<MapCollectionSnapshot>>();
   const changedDuringScan = new Set<TargetId>();
   const listeners = new Set<(targetId: TargetId, snapshot: MapCollectionSnapshot) => void>();
   let disposed = false;
   const isDisposed = () => disposed;
   const unsubscribeDevices = options.devices.subscribe((event) => {
      if (isDisposed()) return;
      const targetId = event.type === 'target-updated' ? event.target.id : event.targetId;
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) {
         if (snapshots.has(targetId)) stale.add(targetId);
         return;
      }
      if (snapshots.has(targetId) && snapshots.get(targetId)?.mapsPath !== questMapsDir(connection.value.gameVersion)) {
         snapshots.delete(targetId);
         folders.delete(targetId);
         stale.delete(targetId);
         return;
      }
      if (stale.delete(targetId)) void rescan(targetId, { installId: questInstallId });
   });

   function list(targetId: TargetId, request: MapCollectionRequest) {
      if (request.installId !== questInstallId) return Promise.resolve(createEmptyMapCollectionSnapshot(request, 'missing'));
      const snapshot = snapshots.get(targetId);
      if (snapshot) return Promise.resolve(snapshot);
      return scanning.get(targetId) ?? rescan(targetId, request);
   }

   function rescan(targetId: TargetId, request: MapCollectionRequest) {
      if (isDisposed() || request.installId !== questInstallId) {
         return Promise.resolve(createEmptyMapCollectionSnapshot(request, 'missing'));
      }
      const pending = scanning.get(targetId);
      if (pending) return pending;
      const previous = snapshots.get(targetId);
      if (previous) publish(targetId, { ...previous, status: 'scanning' });
      const scan = (async () => {
         let snapshot: MapCollectionSnapshot;
         do {
            changedDuringScan.delete(targetId);
            snapshot = await runScan(targetId, request);
         } while (!isDisposed() && changedDuringScan.has(targetId));
         if (!isDisposed() && previous && snapshots.get(targetId)?.status === 'scanning') publish(targetId, previous);
         return snapshot;
      })().finally(() => {
         scanning.delete(targetId);
      });
      scanning.set(targetId, scan);
      return scan;
   }

   function stillConnectedAt(targetId: TargetId, mapsPath: string) {
      if (isDisposed()) return false;
      const current = options.devices.getConnection(targetId);
      return Result.isOk(current) && Boolean(current.value.gameVersion) && questMapsDir(current.value.gameVersion) === mapsPath;
   }

   async function runScan(targetId: TargetId, request: MapCollectionRequest): Promise<MapCollectionSnapshot> {
      const connection = options.devices.getConnection(targetId);
      if (request.installId !== questInstallId || Result.isError(connection) || !connection.value.gameVersion) {
         return createEmptyMapCollectionSnapshot(request, 'missing');
      }
      const mapsPath = questMapsDir(connection.value.gameVersion);
      const { client, serial } = connection.value;
      const exists = await client.fileExists(serial, mapsPath);
      if (Result.isError(exists)) return failedSnapshot(request, mapsPath, exists.error);
      if (!exists.value) {
         if (!stillConnectedAt(targetId, mapsPath)) return createEmptyMapCollectionSnapshot(request, 'missing');
         return publish(targetId, { ...createEmptyMapCollectionSnapshot(request, 'missing'), mapsPath });
      }
      const listed = await client.listModified(serial, mapsPath);
      if (Result.isError(listed)) return failedSnapshot(request, mapsPath, listed.error);
      const present = listed.value.filter((entry) => isSafeFileName(entry.name)).sort((first, second) => second.modifiedAt - first.modifiedAt);
      const known = folders.get(targetId) ?? (await cache.load(targetId, mapsPath));
      if (!stillConnectedAt(targetId, mapsPath)) {
         stale.add(targetId);
         return failedSnapshot(request, mapsPath, createProblem('quest.device.unavailable'));
      }
      const records = new Map<string, QuestMapFolder>();
      for (const entry of present) {
         const cached = known.get(entry.name);
         if (cached?.modifiedAt === entry.modifiedAt) records.set(entry.name, cached);
      }
      const changed = present.filter((entry) => !records.has(entry.name));
      const mapsOf = () => [...records.values()].map((record) => record.map);
      const initial = { ...createEmptyMapCollectionSnapshot(request), mapsPath, progress: { scanned: records.size, total: present.length } };
      if (changed.length > 0) {
         folders.set(targetId, records);
         publish(targetId, { ...initial, maps: mapsOf() });
      }
      for (const [index, { name: folderName, modifiedAt }] of changed.entries()) {
         if (!stillConnectedAt(targetId, mapsPath)) {
            stale.add(targetId);
            return failedSnapshot(request, mapsPath, createProblem('quest.device.unavailable'));
         }
         const scanned = await scanFolder(connection.value, mapsPath, folderName);
         if (!stillConnectedAt(targetId, mapsPath)) {
            stale.add(targetId);
            return failedSnapshot(request, mapsPath, createProblem('quest.device.unavailable'));
         }
         if (scanned) records.set(folderName, questMapFolder(scanned.map, modifiedAt, scanned.fileCount));
         if ((index + 1) % 20 === 0) publish(targetId, { ...initial, maps: mapsOf(), progress: { scanned: records.size, total: present.length } });
      }
      if (!stillConnectedAt(targetId, mapsPath)) {
         stale.add(targetId);
         return failedSnapshot(request, mapsPath, createProblem('quest.device.unavailable'));
      }
      folders.set(targetId, records);
      void cache.save(targetId, mapsPath, records);
      return publish(targetId, {
         ...initial,
         status: 'ready',
         scannedAt: new Date().toISOString(),
         maps: withMapDuplicateFlags(mapsOf().sort((first, second) => first.title.localeCompare(second.title))),
         progress: null
      });
   }

   async function scanFolder({ client, serial }: QuestConnection, mapsPath: string, folderName: string) {
      const path = `${mapsPath}/${folderName}`;
      const files = await client.listFiles(serial, path);
      if (Result.isError(files)) return null;
      const infoName = files.value.find((name) => /^info\.dat$/i.test(name));
      if (!infoName) return null;
      const raw = await client.readTextFile(serial, `${path}/${infoName}`);
      if (Result.isError(raw)) return null;
      const info = parseMapInfo(raw.value, folderName);
      if (Result.isError(info)) return null;
      const referenced = [
         ...(info.value.audioDataFileName ? [info.value.audioDataFileName] : []),
         ...info.value.difficulties.flatMap((difficulty) => [
            difficulty.beatmapFileName,
            ...(difficulty.lightshowFileName ? [difficulty.lightshowFileName] : [])
         ])
      ];
      const hash = await client.sha1Files(
         serial,
         [infoName, ...referenced].map((name) => `${path}/${name}`)
      );
      const size = await client.directoryStats(serial, path);
      const map: LocalMapSummary = {
         id: folderName,
         folderName,
         path,
         hash: Result.isOk(hash) ? hash.value : null,
         title: info.value.title || folderName,
         subTitle: info.value.subTitle,
         artist: info.value.artist,
         mappers: info.value.mappers,
         bpm: info.value.bpm,
         durationSeconds: info.value.durationSeconds,
         difficulties: info.value.difficulties.map(({ characteristic, difficulty }) => ({ characteristic, difficulty })),
         coverFileName: info.value.coverFileName,
         sizeBytes: Result.isOk(size) ? size.value.bytes : 0,
         updatedAt: new Date().toISOString(),
         isDuplicate: false
      };
      return { map, fileCount: Result.isOk(size) ? size.value.files : 0 };
   }

   async function getCovers(targetId: TargetId, request: MapCoversRequest) {
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) return { covers: [], deferredMapIds: [] };
      const snapshot = await list(targetId, request);
      const selected = new Set(request.mapIds);
      const read = [];
      for (const map of snapshot.maps) {
         if (!selected.has(map.id) || !map.coverFileName) continue;
         const mimeType = coverMimeType(map.coverFileName);
         if (!mimeType) continue;
         const encoded = await connection.value.client.shell(
            connection.value.serial,
            `head -c ${maxCoverBytes + 1} ${quoteShellArg(`${map.path}/${map.coverFileName}`)} | base64`
         );
         if (Result.isError(encoded)) continue;
         const bytes = Buffer.from(encoded.value.replaceAll(/\s/g, ''), 'base64');
         const dataUrl = bytes.byteLength > 0 ? coverDataUrl(mimeType, bytes) : null;
         if (dataUrl) read.push({ mapId: map.id, dataUrl });
      }
      return packCovers(read);
   }

   function search(targetId: TargetId, request: MapSearchRequest) {
      return searchBeatSaver(
         catalog,
         request,
         async () => new Set((await list(targetId, request)).maps.flatMap((map) => (map.hash ? [map.hash] : [])))
      );
   }

   async function previewDelete(targetId: TargetId, request: MapSelectionRequest): Promise<MapDeletePreview> {
      if (request.mapIds.length === 0) return invalidMapAction(request, 'no-selection');
      const snapshot = await list(targetId, request);
      if (!snapshot.mapsPath || snapshot.status !== 'ready') return invalidMapAction(request, 'maps-missing');
      const ids = new Set(request.mapIds);
      const selected = snapshot.maps.filter((map) => ids.has(map.id));
      if (selected.length !== ids.size) return invalidMapAction(request, 'not-found');
      return {
         status: 'ok',
         installId: request.installId,
         mapsPath: snapshot.mapsPath,
         names: selected.map((map) => map.title),
         mapCount: selected.length,
         sizeBytes: selected.reduce((total, map) => total + map.sizeBytes, 0),
         fileCount: selected.reduce((total, map) => total + (folders.get(targetId)?.get(map.id)?.fileCount ?? 0), 0)
      };
   }

   function startDelete(targetId: TargetId, request: MapSelectionRequest) {
      return Result.gen(async function* () {
         const preview = await previewDelete(targetId, request);
         if (preview.status === 'invalid') return Result.err(mapFailure(request.installId, preview.issue, preview.detail).error);
         const connection = yield* options.devices.getConnection(targetId);
         const selected = snapshots.get(targetId)?.maps.filter((map) => request.mapIds.includes(map.id)) ?? [];
         const job = yield* options.mutations.acquire(targetId);
         return Result.ok(
            options.operations.start(
               { kind: 'delete', targetId, title: translate('maps.operations.delete', { count: selected.length }) },
               (operationId, signal) => runDelete(operationId, targetId, connection, selected, signal),
               job
            )
         );
      });
   }

   async function runDelete(operationId: string, targetId: TargetId, connection: QuestConnection, selected: LocalMapSummary[], signal: AbortSignal) {
      let failure: Problem | null = null;
      for (const map of selected) {
         if (signal.aborted) break;
         const deleted = await connection.client.removePath(connection.serial, map.path);
         if (Result.isError(deleted)) {
            failure = deleted.error;
            break;
         }
      }
      const exists = await Promise.all(selected.map((map) => connection.client.fileExists(connection.serial, map.path)));
      const removed = selected.filter((_map, index) => {
         const checked = exists[index];
         return checked !== undefined && Result.isOk(checked) && !checked.value;
      });
      updateFolders(targetId, (records) => {
         for (const map of removed) records.delete(map.id);
      });
      if (signal.aborted) return;
      if (failure) return options.operations.fail(operationId, failure);
      options.operations.complete(operationId, { mapCount: selected.length });
   }

   function startDownload(targetId: TargetId, request: MapDownloadRequest) {
      return Result.gen(async function* () {
         if (request.installId !== questInstallId) return Result.err(mapFailure(request.installId, 'install-not-found').error);
         const connection = yield* options.devices.getConnection(targetId);
         if (!connection.modloaderInstalled) return Result.err(createProblem('quest.maps.patch-required'));
         const found = await catalog.getByKey(request.source.key);
         if (Result.isError(found)) return Result.err(mapFailure(request.installId, 'source-unavailable', found.error.detail).error);
         const record = found.value;
         if (snapshots.get(targetId)?.maps.some((map) => map.hash === record.summary.hash))
            return Result.err(mapFailure(request.installId, 'already-installed', record.summary.title).error);
         const job = yield* options.mutations.acquire(targetId);
         return Result.ok(
            options.operations.start(
               { kind: 'download', targetId, title: translate('maps.operations.download', { title: record.summary.title }) },
               (operationId, signal) => runDownload(operationId, targetId, connection, record, signal),
               job
            )
         );
      });
   }

   async function runDownload(operationId: string, targetId: TargetId, connection: QuestConnection, record: BeatSaverMapRecord, signal: AbortSignal) {
      const installed = await installMap(
         targetId,
         connection,
         {
            source: { kind: 'url', url: record.downloadUrl },
            fallbackName: record.summary.key,
            expectedHash: record.summary.hash,
            allowedHosts: beatSaverDownloadHosts
         },
         signal,
         (progress) => {
            options.operations.update(operationId, { progress });
         }
      );
      if (signal.aborted) return;
      if (Result.isError(installed)) return options.operations.fail(operationId, installed.error);
      options.operations.complete(operationId, { installId: questInstallId, hash: installed.value });
   }

   async function installMap(
      targetId: TargetId,
      connection: QuestConnection,
      archive: MapArchiveSource & { allowedHosts?: readonly string[] },
      signal: AbortSignal,
      onProgress: (progress: OperationProgress) => void
   ): Promise<Result<string, Problem>> {
      const prepared = await stageMapArchive({ ...archive, ingestion: options.ingestion, signal, onProgress });
      if (Result.isError(prepared)) return Result.err(prepared.error);
      const { staged, map } = prepared.value;
      const { client, serial } = connection;
      const temporary = `${questStagingDir}/map-${randomUUID()}`;
      try {
         return await Result.gen(async function* () {
            const mapsPath = questMapsDir(connection.gameVersion);
            const destination = `${mapsPath}/${map.hash}`;
            if (
               (yield* Result.await(client.fileExists(serial, destination))) ||
               snapshots.get(targetId)?.maps.some((entry) => entry.hash === map.hash)
            )
               return Result.err(createProblem('maps.already-installed', { folderName: map.hash }));
            yield* Result.await(client.mkdirs(serial, temporary));
            const files = staged.manifest.entries.filter((entry) => entry.kind === 'file');
            for (const [index, file] of files.entries()) {
               if (signal.aborted) return Result.err(createProblem('quest.maps.cancelled'));
               const remotePath = `${temporary}/${file.path}`;
               yield* Result.await(client.mkdirs(serial, posix.dirname(remotePath)));
               yield* Result.await(client.push(serial, join(staged.extractedPath, file.path), remotePath));
               onProgress({ phase: 'uploading', current: index + 1, total: files.length, unit: 'items' });
            }
            if (signal.aborted) return Result.err(createProblem('quest.maps.cancelled'));
            yield* Result.await(client.mkdirs(serial, mapsPath));
            yield* Result.await(client.movePath(serial, temporary, destination));
            const modifiedAt = await client.modifiedAt(serial, destination);
            addToSnapshot(targetId, Result.isOk(modifiedAt) ? modifiedAt.value : Date.now(), files.length, {
               id: map.hash,
               folderName: map.hash,
               path: destination,
               hash: map.hash,
               title: map.info.title || map.hash,
               subTitle: map.info.subTitle,
               artist: map.info.artist,
               mappers: map.info.mappers,
               bpm: map.info.bpm,
               durationSeconds: map.info.durationSeconds,
               difficulties: map.info.difficulties.map(({ characteristic, difficulty }) => ({ characteristic, difficulty })),
               coverFileName: map.info.coverFileName,
               sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
               updatedAt: new Date().toISOString(),
               isDuplicate: false
            });
            return Result.ok(map.hash);
         });
      } finally {
         await staged.dispose();
         await client.removePath(serial, temporary);
      }
   }

   async function exportArchive(targetId: TargetId, request: MapDetailRequest): Promise<Result<AsyncIterable<Uint8Array>, TargetUploadFailure>> {
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) return Result.err({ kind: 'unavailable', ...connection.error });
      const map = request.installId === questInstallId ? (await list(targetId, request)).maps.find((entry) => entry.id === request.mapId) : undefined;
      if (!map) return Result.err({ kind: 'not-found', ...createProblem('maps.not-found') });
      const area = await options.ingestion.staging.create('quest-map-export');
      if (Result.isError(area)) return Result.err({ kind: 'unavailable', ...area.error });
      const pulled = await pullMapFiles(connection.value, map.path, area.value.path);
      const archive = Result.isOk(pulled) ? await openMapArchive(area.value.path) : Result.err(pulled.error);
      if (Result.isError(archive)) {
         await area.value.dispose();
         return Result.err({ kind: 'unavailable', ...archive.error });
      }
      return Result.ok(disposeAfter(archive.value, area.value.dispose));
   }

   async function pullMapFiles({ client, serial }: QuestConnection, remotePath: string, localPath: string): Promise<Result<void, Problem>> {
      const listed = await client.listFiles(serial, remotePath);
      if (Result.isError(listed)) return Result.err(listed.error);
      for (const name of listed.value.filter(isSafeFileName)) {
         const pulled = await client.pull(serial, `${remotePath}/${name}`, join(localPath, name));
         if (Result.isError(pulled)) return pulled;
      }
      return Result.ok(undefined);
   }

   async function importArchive(
      targetId: TargetId,
      request: MapCollectionRequest,
      source: AsyncIterable<Uint8Array>
   ): Promise<Result<void, TargetUploadFailure>> {
      if (request.installId !== questInstallId) return Result.err({ kind: 'not-found', ...createProblem('maps.install-not-found') });
      const connection = options.devices.getConnection(targetId);
      if (Result.isError(connection)) return Result.err({ kind: 'unavailable', ...connection.error });
      if (!connection.value.modloaderInstalled) return Result.err({ kind: 'invalid', ...createProblem('quest.maps.patch-required') });
      const job = options.mutations.acquire(targetId);
      if (Result.isError(job)) return Result.err({ kind: 'unavailable', ...job.error });
      try {
         const received = await receiveMapArchive(options.ingestion.staging, source);
         if (Result.isError(received)) return Result.err(received.error);
         const installed = await installMap(
            targetId,
            connection.value,
            { source: { kind: 'file', path: received.value.archivePath }, fallbackName: 'map' },
            job.value.signal,
            () => {}
         );
         await received.value.dispose();
         return Result.isError(installed) && installed.error.code !== 'maps.already-installed'
            ? Result.err({ kind: 'invalid', ...installed.error })
            : Result.ok(undefined);
      } finally {
         job.value.release();
      }
   }

   function addToSnapshot(targetId: TargetId, modifiedAt: number, fileCount: number, map: LocalMapSummary) {
      updateFolders(targetId, (records) => records.set(map.id, questMapFolder(map, modifiedAt, fileCount)));
   }

   function updateFolders(targetId: TargetId, change: (records: Map<string, QuestMapFolder>) => void) {
      if (scanning.has(targetId)) changedDuringScan.add(targetId);
      const snapshot = snapshots.get(targetId);
      if (!snapshot?.mapsPath) return;
      const records =
         snapshot.status === 'missing' ? new Map<string, QuestMapFolder>() : snapshot.status === 'ready' ? folders.get(targetId) : undefined;
      if (!records) return;
      folders.set(targetId, records);
      change(records);
      void cache.save(targetId, snapshot.mapsPath, records);
      publish(targetId, {
         ...snapshot,
         status: 'ready',
         scannedAt: snapshot.scannedAt ?? new Date().toISOString(),
         maps: withMapDuplicateFlags([...records.values()].map((record) => record.map))
      });
   }

   function publish(targetId: TargetId, snapshot: MapCollectionSnapshot) {
      snapshots.set(targetId, snapshot);
      for (const listener of listeners) listener(targetId, snapshot);
      return snapshot;
   }

   function subscribe(listener: (targetId: TargetId, snapshot: MapCollectionSnapshot) => void) {
      listeners.add(listener);
      return () => {
         listeners.delete(listener);
      };
   }

   function dispose() {
      disposed = true;
      unsubscribeDevices();
      listeners.clear();
      snapshots.clear();
      folders.clear();
      stale.clear();
   }

   return { list, rescan, getCovers, search, previewDelete, startDelete, startDownload, exportArchive, importArchive, subscribe, dispose };
}

async function* disposeAfter(stream: AsyncIterable<Uint8Array>, dispose: () => Promise<void>) {
   try {
      yield* stream;
   } finally {
      await dispose();
   }
}

function failedSnapshot(request: MapCollectionRequest, mapsPath: string, error: Problem): MapCollectionSnapshot {
   return {
      ...createEmptyMapCollectionSnapshot(request, 'ready'),
      mapsPath,
      problems: [createProblem('maps.root.unreadable', { cause: error.message })],
      scannedAt: new Date().toISOString()
   };
}
