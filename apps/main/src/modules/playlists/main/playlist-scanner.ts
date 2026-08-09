import { Result } from 'better-result';

import { scanInBatches } from '@/lib/filesystem/scan';
import type { MapHash } from '@/modules/maps/contract';
import type { LocalPlaylistSummary, PlaylistProblem } from '@/modules/playlists/contract';
import { maxPlaylistBytes, parsePlaylistDocument } from '@/modules/playlists/main/playlist-file';
import { isPlaylistFileName, playlistsPath } from '@/modules/playlists/main/playlist-paths';
import { createPlaylistProblem } from '@/modules/playlists/main/playlist-problem';

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export type PlaylistRecord = {
   summary: LocalPlaylistSummary;
   hashes: MapHash[];
};

export type PlaylistScanCacheEntry = {
   fingerprint: string;
   record: PlaylistRecord;
};

export type PlaylistScanCache = Map<string, PlaylistScanCacheEntry>;

export type PlaylistScanOptions = {
   installPath: string;
   cache?: PlaylistScanCache;
   signal?: AbortSignal;
   onProgress?: (progress: { scanned: number; total: number }) => void;
};

export type PlaylistScanResult = {
   status: 'missing' | 'ready';
   playlistsPath: string;
   records: PlaylistRecord[];
   problems: PlaylistProblem[];
};

export async function scanPlaylists(options: PlaylistScanOptions): Promise<PlaylistScanResult> {
   const rootPath = playlistsPath(options.installPath);
   const entries = await Result.tryPromise({
      try: () => readdir(rootPath, { withFileTypes: true }),
      catch: (cause) => createPlaylistProblem('playlists.root.unreadable', 'the playlists folder could not be read', { cause })
   });

   if (Result.isError(entries)) {
      const missing = entries.error.detail === 'ENOENT';
      return {
         status: missing ? 'missing' : 'ready',
         playlistsPath: rootPath,
         records: [],
         problems: missing ? [] : [entries.error]
      };
   }

   const fileNames = entries.value.filter((entry) => entry.isFile() && isPlaylistFileName(entry.name)).map((entry) => entry.name);
   const records = await scanInBatches(fileNames, { ...options, batchSize: 4 }, (fileName) => scanPlaylistFile(rootPath, fileName, options.cache));

   records.sort(
      (first, second) => first.summary.title.localeCompare(second.summary.title) || first.summary.fileName.localeCompare(second.summary.fileName)
   );

   return { status: 'ready', playlistsPath: rootPath, records, problems: [] };
}

async function scanPlaylistFile(rootPath: string, fileName: string, cache?: PlaylistScanCache): Promise<PlaylistRecord> {
   const filePath = join(rootPath, fileName);
   const stats = await Result.tryPromise({
      try: () => stat(filePath),
      catch: (cause) => createPlaylistProblem('playlists.file.unreadable', 'this playlist could not be read', { fileName, cause })
   });
   if (Result.isError(stats)) return emptyRecord(filePath, fileName, stats.error);

   const sizeBytes = stats.value.size;
   const updatedAt = new Date(stats.value.mtimeMs).toISOString();

   if (sizeBytes > maxPlaylistBytes) {
      return emptyRecord(filePath, fileName, createPlaylistProblem('playlists.file.too-large', 'this playlist is too large to read', { fileName }), {
         sizeBytes,
         updatedAt
      });
   }

   const fingerprint = `${sizeBytes}:${updatedAt}`;
   const cached = cache?.get(fileName);
   if (cached?.fingerprint === fingerprint) return cached.record;

   const raw = await Result.tryPromise({
      try: () => readFile(filePath, 'utf8'),
      catch: (cause) => createPlaylistProblem('playlists.file.unreadable', 'this playlist could not be read', { fileName, cause })
   });
   if (Result.isError(raw)) return emptyRecord(filePath, fileName, raw.error, { sizeBytes, updatedAt });

   const parsed = parsePlaylistDocument(raw.value, fileName);
   if (Result.isError(parsed)) return emptyRecord(filePath, fileName, parsed.error, { sizeBytes, updatedAt });

   const record: PlaylistRecord = {
      summary: {
         id: fileName,
         fileName,
         path: filePath,
         title: parsed.value.title,
         author: parsed.value.author,
         description: parsed.value.description,
         songCount: parsed.value.songs.length,
         missingCount: 0,
         syncUrl: parsed.value.syncUrl,
         sizeBytes,
         updatedAt
      },
      hashes: parsed.value.songs.flatMap((song) => (song.hash ? [song.hash] : []))
   };
   cache?.set(fileName, { fingerprint, record });

   return record;
}

function emptyRecord(filePath: string, fileName: string, problem: PlaylistProblem, stats?: { sizeBytes: number; updatedAt: string }): PlaylistRecord {
   return {
      summary: {
         id: fileName,
         fileName,
         path: filePath,
         title: fileName,
         author: '',
         description: '',
         songCount: 0,
         missingCount: 0,
         syncUrl: null,
         sizeBytes: stats?.sizeBytes ?? 0,
         updatedAt: stats?.updatedAt ?? new Date(0).toISOString(),
         problem
      },
      hashes: []
   };
}
