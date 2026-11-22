import { Result } from 'better-result';

import { claimUniqueArchiveEntryName } from '@/lib/archive/path';
import { exportZip } from '@/lib/archive/zip-write';
import type { ContentProblem } from '@/lib/content/contract';
import { createProblem, type Problem } from '@/lib/errors';
import type { OperationProgress } from '@/modules/operations/contract';
import type { LocalPlaylistSummary, PlaylistProblem } from '@/modules/playlists/contract';
import { writePlaylistFile } from '@/modules/playlists/main/playlist-file';
import { toSafePlaylistFileName } from '@/modules/playlists/main/playlist-paths';

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const maxExportBytes = 64 * 1024 * 1024;

type ExportPlaylistsRequest = {
   playlists: readonly LocalPlaylistSummary[];
   destinationPath: string;
   signal: AbortSignal;
   onProgress: (progress: OperationProgress) => void;
};

type ExportPlaylistsSummary = {
   playlistCount: number;
   bytes: number;
   files: number;
};

export async function exportPlaylists(request: ExportPlaylistsRequest): Promise<Result<ExportPlaylistsSummary, Problem>> {
   const [first] = request.playlists;
   if (!first) return Result.err<ExportPlaylistsSummary, Problem>(createProblem('playlists.no-selection'));

   return extname(request.destinationPath).toLowerCase() === '.zip' ? exportArchive(request) : exportSingle(request, first);
}

function exportSingle(request: ExportPlaylistsRequest, playlist: LocalPlaylistSummary): Promise<Result<ExportPlaylistsSummary, PlaylistProblem>> {
   return Result.gen(async function* () {
      const content = yield* Result.await(readPlaylist(playlist));
      const written = yield* Result.await(writePlaylistFile(request.destinationPath, content));
      request.onProgress({ phase: 'writing', current: written, total: written, percent: 100, unit: 'bytes' });

      return Result.ok({ playlistCount: 1, bytes: written, files: 1 });
   });
}

async function exportArchive(request: ExportPlaylistsRequest): Promise<Result<ExportPlaylistsSummary, ContentProblem>> {
   const usedNames = new Set<string>();
   const exported = await exportZip({
      items: request.playlists,
      destinationPath: request.destinationPath,
      maxBytes: maxExportBytes,
      signal: request.signal,
      onProgress: request.onProgress,
      labelOf: (playlist) => playlist.title || playlist.fileName,
      filesOf: async (playlist) => [
         {
            archivePath: claimUniqueArchiveEntryName(toSafePlaylistFileName(playlist.title || playlist.fileName, playlist.id), usedNames),
            sourcePath: playlist.path
         }
      ]
   });
   return exported.map((summary) => ({ playlistCount: request.playlists.length, ...summary }));
}

function readPlaylist(playlist: LocalPlaylistSummary) {
   return Result.tryPromise({
      try: async () => new Uint8Array(await readFile(playlist.path)),
      catch: (cause): PlaylistProblem => createProblem('playlists.file.unreadable', { fileName: playlist.fileName, cause })
   });
}
