import { Result } from 'better-result';

import { exportZip, zipFiles } from '@/lib/archive/zip-write';
import type { ArchiveLayoutValidator } from '@/lib/content/content-ingestion';
import type { ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { isSafeFileName, toSafeFileName } from '@/lib/filesystem/path';
import type { LocalMapSummary, MapHash, MapProblem } from '@/modules/maps/contract';
import { computeMapHash } from '@/modules/maps/main/map-hash';
import { parseMapInfo, type MapInfo } from '@/modules/maps/main/map-info';
import { infoFileNamePattern } from '@/modules/maps/main/map-paths';
import type { OperationProgress } from '@/modules/operations/contract';

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const maxExportBytes = 512 * 1024 * 1024;

export type StagedMap = {
   info: MapInfo;
   hash: MapHash;
   folderName: string;
};

type ExportMapsRequest = {
   maps: readonly LocalMapSummary[];
   destinationPath: string;
   signal: AbortSignal;
   onProgress: (progress: OperationProgress) => void;
};

type ExportMapsSummary = {
   mapCount: number;
   bytes: number;
   files: number;
};

export function createMapArchiveValidator(): ArchiveLayoutValidator {
   return ({ manifest }) => {
      const hasRootInfo = manifest.entries.some((entry) => entry.kind === 'file' && infoFileNamePattern.test(entry.path));

      if (!hasRootInfo) {
         return Result.err<void, ContentProblem>(createProblem('content.ingest.map-layout', { detail: manifest.rootEntries.slice(0, 4).join(', ') }));
      }

      return Result.ok<void, ContentProblem>(undefined);
   };
}

export function readStagedMap(extractedPath: string, fallbackName: string): Promise<Result<StagedMap, MapProblem>> {
   return Result.gen(async function* () {
      const entries = yield* Result.await(
         Result.tryPromise({
            try: () => readdir(extractedPath, { withFileTypes: true }),
            catch: (cause): MapProblem => createProblem('maps.folder.unreadable', { folderName: fallbackName, cause })
         })
      );

      const infoName = entries.find((entry) => entry.isFile() && infoFileNamePattern.test(entry.name))?.name;
      if (!infoName) return Result.err(createProblem('maps.info.missing', { folderName: fallbackName }));

      const rawInfo = yield* Result.await(
         Result.tryPromise({
            try: () => readFile(join(extractedPath, infoName), 'utf8'),
            catch: (cause): MapProblem => createProblem('maps.info.unreadable', { folderName: fallbackName, cause })
         })
      );
      const info = yield* parseMapInfo(rawInfo, fallbackName);
      const hash = yield* Result.await(computeMapHash({ mapPath: extractedPath, folderName: fallbackName, rawInfo, info }));
      const folderName = toSafeFileName(
         [info.title, info.artist, info.mappers.join(', ')]
            .map((part) => part.trim())
            .filter(Boolean)
            .join(' - '),
         fallbackName
      );

      return Result.ok({ info, hash, folderName });
   });
}

export async function exportMapsToZip(request: ExportMapsRequest): Promise<Result<ExportMapsSummary, ContentProblem>> {
   const usedFolders = new Set<string>();
   const exported = await exportZip({
      items: request.maps,
      destinationPath: request.destinationPath,
      maxBytes: maxExportBytes,
      signal: request.signal,
      onProgress: request.onProgress,
      labelOf: (map) => map.title || map.folderName,
      filesOf: (map) => listMapFiles(map.path, `${uniqueFolderName(toSafeFileName(map.folderName, map.id), usedFolders)}/`)
   });
   return exported.map((summary) => ({ mapCount: request.maps.length, ...summary }));
}

export async function openMapArchive(mapPath: string) {
   const files = await Result.tryPromise({
      try: () => listMapFiles(mapPath),
      catch: (cause): MapProblem => createProblem('maps.folder.unreadable', { cause })
   });

   return Result.map(files, (listed) => zipFiles(listed, { compression: 'store' }));
}

async function listMapFiles(mapPath: string, archiveFolder = '') {
   const entries = await readdir(mapPath, { withFileTypes: true });

   return entries
      .filter((entry) => entry.isFile() && isSafeFileName(entry.name))
      .map((entry) => ({ archivePath: `${archiveFolder}${entry.name}`, sourcePath: join(mapPath, entry.name) }));
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
