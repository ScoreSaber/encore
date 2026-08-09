import { Result } from 'better-result';

import { writeZipAtomic, type ZipSourceFile } from '@/lib/archive/zip-write';
import type { ArchiveLayoutValidator } from '@/lib/content/content-ingestion';
import type { ContentProblem } from '@/lib/content/contract';
import { toSafeFileName } from '@/lib/filesystem/path';
import { isSafeFileName } from '@/lib/filesystem/path';
import type { LocalMapSummary, MapHash, MapProblem } from '@/modules/maps/contract';
import { computeMapHash } from '@/modules/maps/main/map-hash';
import { parseMapInfo, type MapInfo } from '@/modules/maps/main/map-info';
import { infoFileNamePattern } from '@/modules/maps/main/map-paths';
import { createMapProblem, type MapResult } from '@/modules/maps/main/map-problem';
import type { OperationProgress } from '@/modules/operations/contract';

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const maxExportBytes = 512 * 1024 * 1024;

export type StagedMap = {
   info: MapInfo;
   hash: MapHash;
   folderName: string;
};

export type ExportMapsRequest = {
   maps: readonly LocalMapSummary[];
   destinationPath: string;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export type ExportMapsSummary = {
   destinationPath: string;
   mapCount: number;
   bytes: number;
   files: number;
};

export function createMapArchiveValidator(): ArchiveLayoutValidator {
   return ({ manifest }) => {
      const hasRootInfo = manifest.entries.some((entry) => entry.kind === 'file' && infoFileNamePattern.test(entry.path));

      if (!hasRootInfo) {
         return Result.err<void, ContentProblem>({
            code: 'content.ingest.layout-rejected',
            message: 'the archive does not hold a map: Info.dat has to sit at its root',
            detail: manifest.rootEntries.slice(0, 4).join(', ')
         });
      }

      return Result.ok<void, ContentProblem>(undefined);
   };
}

export async function readStagedMap(extractedPath: string, fallbackName: string): Promise<MapResult<StagedMap>> {
   const entries = await Result.tryPromise({
      try: () => readdir(extractedPath, { withFileTypes: true }),
      catch: (cause): MapProblem => createMapProblem('maps.folder.unreadable', 'the unpacked map could not be read', { cause })
   });
   if (Result.isError(entries)) return Result.err<StagedMap, MapProblem>(entries.error);

   const infoName = entries.value.find((entry) => entry.isFile() && infoFileNamePattern.test(entry.name))?.name;
   if (!infoName) {
      return Result.err<StagedMap, MapProblem>(createMapProblem('maps.info.missing', 'the unpacked map has no Info.dat'));
   }

   const rawInfo = await Result.tryPromise({
      try: () => readFile(join(extractedPath, infoName), 'utf8'),
      catch: (cause): MapProblem => createMapProblem('maps.info.invalid', 'the map description could not be read', { cause })
   });
   if (Result.isError(rawInfo)) return Result.err<StagedMap, MapProblem>(rawInfo.error);

   const info = parseMapInfo(rawInfo.value, fallbackName);
   if (Result.isError(info)) return Result.err<StagedMap, MapProblem>(info.error);

   const hash = await computeMapHash({ mapPath: extractedPath, folderName: fallbackName, rawInfo: rawInfo.value, info: info.value });
   if (Result.isError(hash)) return Result.err<StagedMap, MapProblem>(hash.error);
   const folderName = toSafeFileName(
      [info.value.title, info.value.artist, info.value.mappers.join(', ')]
         .map((part) => part.trim())
         .filter(Boolean)
         .join(' - '),
      fallbackName
   );

   return Result.ok<StagedMap, MapProblem>({
      info: info.value,
      hash: hash.value,
      folderName
   });
}

export async function exportMapsToZip(request: ExportMapsRequest): Promise<MapResult<ExportMapsSummary>> {
   const files: ZipSourceFile[] = [];
   const usedFolders = new Set<string>();
   const totalBytes = request.maps.reduce((total, map) => total + map.sizeBytes, 0);
   let bytes = 0;
   let fileCount = 0;

   for (const map of request.maps) {
      if (request.signal?.aborted) {
         return Result.err<ExportMapsSummary, MapProblem>(createMapProblem('maps.export.cancelled', 'the export was cancelled'));
      }

      const folderName = uniqueFolderName(toSafeFileName(map.folderName, map.id), usedFolders);
      const collected = await Result.tryPromise({
         try: () => readdir(map.path, { withFileTypes: true }),
         catch: (cause): MapProblem =>
            createMapProblem('maps.folder.unreadable', 'a selected map folder could not be read', { folderName: map.folderName, cause })
      });
      if (Result.isError(collected)) return Result.err<ExportMapsSummary, MapProblem>(collected.error);

      for (const entry of collected.value) {
         if (!entry.isFile() || !isSafeFileName(entry.name)) continue;

         const sourcePath = join(map.path, entry.name);
         const stats = await Result.tryPromise({
            try: () => stat(sourcePath),
            catch: (cause): MapProblem =>
               createMapProblem('maps.folder.unreadable', 'a map file could not be read', { folderName: map.folderName, cause })
         });
         if (Result.isError(stats)) return Result.err<ExportMapsSummary, MapProblem>(stats.error);

         bytes += stats.value.size;
         if (bytes > maxExportBytes) {
            return Result.err<ExportMapsSummary, MapProblem>(
               createMapProblem('maps.export.failed', 'the selection is too large to export as one archive', { folderName: map.folderName })
            );
         }

         fileCount += 1;
         files.push({ archivePath: `${folderName}/${entry.name}`, sourcePath });
      }

      request.onProgress?.({
         phase: 'reading',
         label: map.title || map.folderName,
         current: bytes,
         total: totalBytes,
         unit: 'bytes'
      });
   }

   if (fileCount === 0) {
      return Result.err<ExportMapsSummary, MapProblem>(createMapProblem('maps.export.failed', 'the selected maps held no readable files'));
   }

   request.onProgress?.({ phase: 'compressing', current: bytes, total: bytes, percent: 100, unit: 'bytes' });

   const written = await writeZipAtomic(request.destinationPath, files, request.signal);
   if (Result.isError(written)) {
      if (request.signal?.aborted) {
         return Result.err<ExportMapsSummary, MapProblem>(createMapProblem('maps.export.cancelled', 'the export was cancelled'));
      }

      return Result.err<ExportMapsSummary, MapProblem>(
         createMapProblem('maps.export.failed', 'the archive could not be written', { cause: written.error.detail })
      );
   }

   return Result.ok<ExportMapsSummary, MapProblem>({
      destinationPath: request.destinationPath,
      mapCount: request.maps.length,
      bytes,
      files: fileCount
   });
}

function uniqueFolderName(name: string, used: Set<string>) {
   let candidate = name;
   let attempt = 1;

   while (used.has(candidate.toLowerCase())) {
      attempt += 1;
      candidate = `${name} (${attempt})`;
   }

   used.add(candidate.toLowerCase());

   return candidate;
}
