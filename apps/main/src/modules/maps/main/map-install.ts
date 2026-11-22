import { Result, TaggedError } from 'better-result';

import type { TargetUploadFailure } from '@/lib/api';
import type { ContentIngestionService, IngestArchiveRequest, StagedArchive } from '@/lib/content/content-ingestion';
import type { ContentLimits } from '@/lib/content/content-limits';
import type { ContentStaging } from '@/lib/content/content-staging';
import type { ContentSource } from '@/lib/content/contract';
import { createProblem, type Problem } from '@/lib/errors';
import { createUniquePath } from '@/lib/filesystem/path';
import type { MapHash } from '@/modules/maps/contract';
import { createMapArchiveValidator, readStagedMap, type StagedMap } from '@/modules/maps/main/map-archive';
import type { OperationProgress } from '@/modules/operations/contract';

import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const maxMapArchiveBytes = 128 * 1024 * 1024;

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

export type InstallMapArchivesInput = {
   ingestion: ContentIngestionService;
   mapsPath: string;
   sources: MapArchiveSource[];
   allowedHosts?: readonly string[];
   installed: Set<MapHash>;
   signal: AbortSignal;
   onProgress: (index: number, progress: OperationProgress) => void;
};

type InstallOutcome = { bytes: number; files: number };

class MapArchiveTooLarge extends TaggedError('MapArchiveTooLarge')() {}

export async function installMapArchives(input: InstallMapArchivesInput) {
   let bytes = 0;
   let files = 0;
   let mapCount = 0;
   let lastProblem: Problem | null = null;

   for (const [index, entry] of input.sources.entries()) {
      if (input.signal.aborted) break;

      const installed = await installMapArchive({ ...input, ...entry, index });
      if (Result.isError(installed)) {
         lastProblem = installed.error;
         continue;
      }

      bytes += installed.value.bytes;
      files += installed.value.files;
      mapCount += 1;
   }

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

async function installMapArchive(input: InstallMapArchivesInput & MapArchiveSource & { index: number }): Promise<Result<InstallOutcome, Problem>> {
   if (input.expectedHash && input.installed.has(input.expectedHash)) {
      return Result.err(createProblem('maps.already-installed', { folderName: input.fallbackName }));
   }

   const prepared = await stageMapArchive({ ...input, onProgress: (progress) => input.onProgress(input.index, progress) });
   if (Result.isError(prepared)) return Result.err(prepared.error);
   const { staged, map } = prepared.value;

   const installed = await Result.gen(async function* () {
      if (input.installed.has(map.hash)) return Result.err(createProblem('maps.already-installed', { folderName: map.folderName }));

      const destinationPath = yield* Result.await(
         createUniquePath(join(input.mapsPath, map.folderName)).then((path) =>
            path.mapError((cause) => createProblem('maps.write.failed', { folderName: map.folderName, cause }))
         )
      );
      const committed = yield* Result.await(
         staged.commit({
            destinationPath,
            destinationRoot: input.mapsPath,
            signal: input.signal,
            onProgress: (progress) => input.onProgress(input.index, progress)
         })
      );

      return Result.ok({ bytes: committed.bytes, files: committed.files });
   });
   if (Result.isError(installed)) await staged.dispose();
   else input.installed.add(map.hash);

   return installed;
}
