import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { scanInBatches } from '@/lib/filesystem/scan';
import type { LocalMapSummary, MapProblem } from '@/modules/maps/contract';
import { computeMapHash } from '@/modules/maps/main/map-hash';
import { parseMapInfo } from '@/modules/maps/main/map-info';
import { customLevelsPath, infoFileNamePattern } from '@/modules/maps/main/map-paths';

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type MapScanCacheEntry = {
   fingerprint: string;
   map: LocalMapSummary;
};

type MapScanCache = Map<string, MapScanCacheEntry>;

type MapScanOptions = {
   installPath: string;
   cache?: MapScanCache;
   onProgress?: (progress: { scanned: number; total: number }) => void;
};

type MapScanResult = {
   status: 'missing' | 'ready';
   mapsPath: string;
   maps: LocalMapSummary[];
   problems: MapProblem[];
};

export async function scanCustomLevels(options: MapScanOptions): Promise<MapScanResult> {
   const mapsPath = customLevelsPath(options.installPath);
   const entries = await Result.tryPromise({
      try: () => readdir(mapsPath, { withFileTypes: true }),
      catch: (cause) => createProblem('maps.root.unreadable', { cause })
   });

   if (Result.isError(entries)) {
      const missing = entries.error.detail === 'ENOENT';
      return {
         status: missing ? 'missing' : 'ready',
         mapsPath,
         maps: [],
         problems: missing ? [] : [entries.error]
      };
   }

   const folders = entries.value.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name);
   const maps = withMapDuplicateFlags(await scanInBatches(folders, options, (folderName) => scanMapFolder(mapsPath, folderName, options.cache)));
   maps.sort((first, second) => first.title.localeCompare(second.title) || first.folderName.localeCompare(second.folderName));

   return { status: 'ready', mapsPath, maps, problems: [] };
}

async function scanMapFolder(mapsPath: string, folderName: string, cache?: MapScanCache): Promise<LocalMapSummary> {
   const mapPath = join(mapsPath, folderName);
   const listing = await readMapFolder(mapPath, folderName);

   if (Result.isError(listing)) {
      return emptyMap(mapPath, folderName, listing.error);
   }

   const { fileNames, sizeBytes, updatedAt } = listing.value;
   const fingerprint = `${sizeBytes}:${updatedAt}:${fileNames.length}`;
   const cached = cache?.get(folderName);
   if (cached?.fingerprint === fingerprint) {
      cached.map.isDuplicate = false;
      return cached.map;
   }

   const map = await readMap({ mapPath, folderName, fileNames, sizeBytes, updatedAt });
   cache?.set(folderName, { fingerprint, map });

   return map;
}

type ReadMapInput = {
   mapPath: string;
   folderName: string;
   fileNames: string[];
   sizeBytes: number;
   updatedAt: string;
};

async function readMap(input: ReadMapInput): Promise<LocalMapSummary> {
   const infoFileName = input.fileNames.find((name) => infoFileNamePattern.test(name));
   if (!infoFileName) {
      return emptyMap(input.mapPath, input.folderName, createProblem('maps.info.missing', { folderName: input.folderName }), input);
   }

   const raw = await Result.tryPromise({
      try: () => readFile(join(input.mapPath, infoFileName), 'utf8'),
      catch: (cause) => createProblem('maps.info.unreadable', { folderName: input.folderName, cause })
   });
   if (Result.isError(raw)) return emptyMap(input.mapPath, input.folderName, raw.error, input);

   const info = parseMapInfo(raw.value, input.folderName);
   if (Result.isError(info)) return emptyMap(input.mapPath, input.folderName, info.error, input);

   const hash = await computeMapHash({ mapPath: input.mapPath, folderName: input.folderName, rawInfo: raw.value, info: info.value });
   const coverName = info.value.coverFileName?.toLowerCase();
   const coverFileName = coverName ? (input.fileNames.find((name) => name.toLowerCase() === coverName) ?? null) : null;

   const map: LocalMapSummary = {
      id: input.folderName,
      folderName: input.folderName,
      path: input.mapPath,
      hash: Result.isOk(hash) ? hash.value : null,
      title: info.value.title || input.folderName,
      subTitle: info.value.subTitle,
      artist: info.value.artist,
      mappers: info.value.mappers,
      bpm: info.value.bpm,
      durationSeconds: info.value.durationSeconds,
      difficulties: info.value.difficulties.map((difficulty) => ({ characteristic: difficulty.characteristic, difficulty: difficulty.difficulty })),
      coverFileName,
      sizeBytes: input.sizeBytes,
      updatedAt: input.updatedAt,
      isDuplicate: false
   };
   if (Result.isError(hash)) map.problem = hash.error;
   return map;
}

function emptyMap(mapPath: string, folderName: string, problem: MapProblem, input?: ReadMapInput): LocalMapSummary {
   return {
      id: folderName,
      folderName,
      path: mapPath,
      hash: null,
      title: folderName,
      subTitle: '',
      artist: '',
      mappers: [],
      bpm: null,
      durationSeconds: null,
      difficulties: [],
      coverFileName: null,
      sizeBytes: input?.sizeBytes ?? 0,
      updatedAt: input?.updatedAt ?? new Date(0).toISOString(),
      isDuplicate: false,
      problem
   };
}

async function readMapFolder(mapPath: string, folderName: string) {
   return Result.tryPromise({
      try: async () => {
         const entries = await readdir(mapPath, { withFileTypes: true });
         const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

         let sizeBytes = 0;
         let updatedAtMs = 0;
         for (const name of fileNames) {
            const entry = await Result.tryPromise(() => stat(join(mapPath, name)));
            if (Result.isError(entry)) continue;

            sizeBytes += entry.value.size;
            updatedAtMs = Math.max(updatedAtMs, entry.value.mtimeMs);
         }

         return { fileNames, sizeBytes, updatedAt: new Date(updatedAtMs).toISOString() };
      },
      catch: (cause) => createProblem('maps.folder.unreadable', { folderName, cause })
   });
}

export function withMapDuplicateFlags(maps: LocalMapSummary[]) {
   const counts = new Map<string, number>();
   for (const map of maps) {
      if (map.hash) counts.set(map.hash, (counts.get(map.hash) ?? 0) + 1);
   }

   for (const map of maps) {
      map.isDuplicate = map.hash !== null && (counts.get(map.hash) ?? 0) > 1;
   }

   return maps;
}
