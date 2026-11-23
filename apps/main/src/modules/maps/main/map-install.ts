import { Result, TaggedError } from 'better-result';

import type { TargetUploadFailure } from '@/lib/api';
import type { ContentIngestionService, IngestArchiveRequest, StagedArchive } from '@/lib/content/content-ingestion';
import type { ContentLimits } from '@/lib/content/content-limits';
import type { ContentStaging } from '@/lib/content/content-staging';
import type { ContentSource } from '@/lib/content/contract';
import { createProblem, type Problem } from '@/lib/errors';
import { pathExists, resolveFilesystemPath, type FilesystemProblem } from '@/lib/filesystem/path';
import type { MapHash } from '@/modules/maps/contract';
import { createMapArchiveValidator, readStagedMap, type StagedMap } from '@/modules/maps/main/map-archive';
import type { OperationProgress } from '@/modules/operations/contract';

import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export const mapInstallConcurrency = 6;

const maxMapArchiveBytes = 128 * 1024 * 1024;
const maxUniquePathAttempts = 200;
const progressThrottleMs = 100;

const mapContentLimits: Partial<ContentLimits> = {
   maxDownloadBytes: maxMapArchiveBytes,
   maxArchiveBytes: maxMapArchiveBytes,
   maxEntries: 200,
   maxEntryBytes: 64 * 1024 * 1024,
   maxTotalBytes: 256 * 1024 * 1024,
   maxPathDepth: 3
};

export type MapArchiveSource = {
   source: ContentSource;
   fallbackName: string;
   expectedHash?: MapHash;
};

type MapInstallBase = {
   ingestion: ContentIngestionService;
   mapsPath: string;
   allowedHosts?: readonly string[];
   installed: Set<MapHash>;
   signal: AbortSignal;
   onProgress: (progress: OperationProgress) => void;
};

export type InstallMapArchivesInput = MapInstallBase & {
   sources: readonly MapArchiveSource[];
};

type InstallMapArchiveStreamInput = MapInstallBase & {
   total: number;
   nextSource: () => Promise<MapArchiveSource | null>;
   skippedCount?: () => number;
};

type InstallOutcome = { bytes: number; files: number };

type InstallMapArchivesOutcome = {
   bytes: number;
   files: number;
   mapCount: number;
   lastProblem: Problem | null;
};

type PathReservation = ReturnType<typeof createPathReservation>;

class MapArchiveTooLarge extends TaggedError('MapArchiveTooLarge')() {}

export async function installMapArchives(input: InstallMapArchivesInput): Promise<InstallMapArchivesOutcome> {
   let cursor = 0;

   return installMapArchiveStream({
      ...input,
      total: input.sources.length,
      nextSource: () => {
         const next = input.sources[cursor];
         cursor += 1;
         return Promise.resolve(next ?? null);
      }
   });
}

export async function installMapArchiveStream(input: InstallMapArchiveStreamInput): Promise<InstallMapArchivesOutcome> {
   if (input.total <= 0) return { bytes: 0, files: 0, mapCount: 0, lastProblem: null };

   const workerCount = Math.min(mapInstallConcurrency, input.total);
   let bytes = 0;
   let files = 0;
   let mapCount = 0;
   let finished = 0;
   let lastProblem: Problem | null = null;
   const inFlightHashes = new Set<MapHash>();
   const activeFractions = Array.from({ length: workerCount }, () => 0);
   const reservation = createPathReservation();
   let lastReportedAt = 0;
   let highestPercent = 0;

   const report = (phase: string, label: string | undefined, force = false) => {
      if (input.signal.aborted) return;

      const now = Date.now();
      if (!force && now - lastReportedAt < progressThrottleMs) return;
      lastReportedAt = now;

      const done = finished + (input.skippedCount?.() ?? 0);
      let partial = 0;
      for (const fraction of activeFractions) partial += fraction;

      const rawPercent = Math.min(100, Math.round(((done + partial) / input.total) * 100));
      highestPercent = Math.max(highestPercent, rawPercent);

      const nextProgress: OperationProgress = {
         phase,
         current: Math.min(done, input.total),
         total: input.total,
         percent: highestPercent,
         unit: 'items'
      };
      if (label) nextProgress.label = label;
      input.onProgress(nextProgress);
   };

   async function worker(workerIndex: number) {
      for (;;) {
         if (input.signal.aborted) break;

         const entry = await input.nextSource();
         if (!entry || input.signal.aborted) break;

         activeFractions[workerIndex] = 0;

         const archiveInput: InstallMapArchiveInput = {
            ingestion: input.ingestion,
            mapsPath: input.mapsPath,
            installed: input.installed,
            signal: input.signal,
            ...entry,
            inFlightHashes,
            reservation,
            onProgress: (progress) => {
               activeFractions[workerIndex] = Math.max(activeFractions[workerIndex] ?? 0, itemFraction(progress));
               report(progress.phase ?? 'installing', progress.label);
            }
         };
         if (input.allowedHosts) archiveInput.allowedHosts = input.allowedHosts;

         const installed = await installMapArchive(archiveInput);

         activeFractions[workerIndex] = 0;
         finished += 1;

         if (Result.isError(installed)) {
            if (!input.signal.aborted) lastProblem = installed.error;
         } else {
            bytes += installed.value.bytes;
            files += installed.value.files;
            mapCount += 1;
         }

         report('installing', entry.fallbackName, true);
      }
   }

   await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index)));

   return { bytes, files, mapCount, lastProblem };
}

export async function receiveMapArchive(
   staging: ContentStaging,
   source: AsyncIterable<Uint8Array>
): Promise<Result<{ archivePath: string; dispose: () => Promise<void> }, TargetUploadFailure>> {
   const area = await staging.create('map-upload');
   if (Result.isError(area)) {
      return Result.err({
         kind: 'unavailable',
         code: area.error.code,
         message: area.error.message
      });
   }

   const archivePath = join(area.value.path, 'map.zip');
   const written = await Result.tryPromise({
      try: () => pipeline(capBytes(source, maxMapArchiveBytes), createWriteStream(archivePath, { flags: 'wx' })),
      catch: (cause): TargetUploadFailure => ({
         kind: 'invalid',
         ...createProblem(cause instanceof MapArchiveTooLarge ? 'maps.upload.too-large' : 'maps.upload.failed', { cause })
      })
   });
   if (Result.isError(written)) {
      await area.value.dispose();
      return Result.err(written.error);
   }

   return Result.ok({ archivePath, dispose: area.value.dispose });
}

async function* capBytes(source: AsyncIterable<Uint8Array>, maxBytes: number) {
   let bytes = 0;
   for await (const chunk of source) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new MapArchiveTooLarge();
      yield chunk;
   }
}

export async function stageMapArchive(
   input: MapArchiveSource & {
      ingestion: ContentIngestionService;
      allowedHosts?: readonly string[];
      signal: AbortSignal;
      onProgress: (progress: OperationProgress) => void;
   }
): Promise<Result<{ staged: StagedArchive; map: StagedMap }, Problem>> {
   const request: IngestArchiveRequest = {
      source: input.source,
      limits: mapContentLimits,
      signal: input.signal,
      validate: createMapArchiveValidator(),
      onProgress: input.onProgress
   };
   if (input.allowedHosts) request.urlPolicy = { allowedHosts: input.allowedHosts };
   const staged = await input.ingestion.ingestArchive(request);
   if (Result.isError(staged)) return Result.err(staged.error);

   const map = await Result.gen(async function* () {
      const read = yield* Result.await(readStagedMap(staged.value.extractedPath, input.fallbackName));
      if (input.expectedHash && input.expectedHash !== read.hash)
         return Result.err(createProblem('maps.hash.mismatch', { folderName: read.folderName }));
      return Result.ok(read);
   });
   if (Result.isError(map)) await staged.value.dispose();

   return map.map((read) => ({ staged: staged.value, map: read }));
}

type InstallMapArchiveInput = MapInstallBase &
   MapArchiveSource & {
      inFlightHashes: Set<MapHash>;
      reservation: PathReservation;
   };

async function installMapArchive(input: InstallMapArchiveInput): Promise<Result<InstallOutcome, Problem>> {
   let claimedHash: MapHash | null = null;

   if (input.expectedHash) {
      if (input.installed.has(input.expectedHash) || input.inFlightHashes.has(input.expectedHash)) {
         return Result.err(createProblem('maps.already-installed', { folderName: input.fallbackName }));
      }
      input.inFlightHashes.add(input.expectedHash);
      claimedHash = input.expectedHash;
   }

   const prepared = await stageMapArchive(input);
   if (Result.isError(prepared)) {
      if (claimedHash) input.inFlightHashes.delete(claimedHash);
      return Result.err(prepared.error);
   }
   const { staged, map } = prepared.value;

   let reservedPath: string | null = null;
   const installed = await Result.gen(async function* () {
      if (!claimedHash) {
         if (input.installed.has(map.hash) || input.inFlightHashes.has(map.hash)) {
            return Result.err(createProblem('maps.already-installed', { folderName: map.folderName }));
         }
         input.inFlightHashes.add(map.hash);
         claimedHash = map.hash;
      }

      const destinationPath = yield* Result.await(
         input.reservation
            .reserve(join(input.mapsPath, map.folderName))
            .then((path) => path.mapError((cause) => createProblem('maps.write.failed', { folderName: map.folderName, cause })))
      );
      reservedPath = destinationPath;

      const committed = yield* Result.await(
         staged.commit({
            destinationPath,
            destinationRoot: input.mapsPath,
            signal: input.signal,
            onProgress: input.onProgress
         })
      );

      return Result.ok({ bytes: committed.bytes, files: committed.files });
   });

   if (Result.isOk(installed)) input.installed.add(map.hash);
   if (reservedPath) input.reservation.release(reservedPath);
   if (claimedHash) input.inFlightHashes.delete(claimedHash);

   if (Result.isError(installed)) await staged.dispose();

   return installed;
}

function itemFraction(progress: OperationProgress) {
   const ratio = Math.min(1, Math.max(0, (progress.percent ?? 0) / 100));
   switch (progress.phase) {
      case 'downloading':
         return ratio * 0.7;
      case 'extracting':
         return 0.7 + ratio * 0.15;
      case 'copying':
         return 0.85 + ratio * 0.15;
      default:
         return ratio;
   }
}

function createPathReservation() {
   const reserved = new Set<string>();
   let queue = Promise.resolve();

   const toKey = (path: string) => (process.platform === 'win32' || process.platform === 'darwin' ? path.toLowerCase() : path);

   async function claim(desiredPath: string): Promise<Result<string, FilesystemProblem>> {
      const path = resolveFilesystemPath(desiredPath);

      for (let attempt = 0; attempt <= maxUniquePathAttempts; attempt += 1) {
         const candidate = attempt === 0 ? path : `${path} (${attempt})`;
         const key = toKey(candidate);
         if (reserved.has(key)) continue;

         const exists = await pathExists(candidate);
         if (Result.isError(exists)) return Result.err(exists.error);
         if (!exists.value) {
            reserved.add(key);
            return Result.ok(candidate);
         }
      }

      return Result.err(createProblem('filesystem.operation.destination-exists', { path }));
   }

   function reserve(desiredPath: string) {
      const next = queue.then(() => claim(desiredPath));
      queue = next.then(
         () => undefined,
         () => undefined
      );
      return next;
   }

   function release(path: string) {
      reserved.delete(toKey(path));
   }

   return { reserve, release };
}
