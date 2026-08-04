import { Result } from 'better-result';

import { claimUniqueArchiveEntryName } from '@/lib/archive/path';
import { writeZipAtomic, type ZipSourceFile } from '@/lib/archive/zip-write';
import { writeFileAtomic } from '@/lib/filesystem/atomic-write';
import type { OperationProgress } from '@/modules/operations/contract';
import type { LocalPlaylistSummary, PlaylistProblem } from '@/modules/playlists/contract';
import { toSafePlaylistFileName } from '@/modules/playlists/main/playlist-paths';
import { createPlaylistProblem, type PlaylistResult } from '@/modules/playlists/main/playlist-problem';

import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const maxExportBytes = 64 * 1024 * 1024;

export type ExportPlaylistsRequest = {
   playlists: readonly LocalPlaylistSummary[];
   destinationPath: string;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export type ExportPlaylistsSummary = {
   destinationPath: string;
   playlistCount: number;
   bytes: number;
   files: number;
};

export async function exportPlaylists(request: ExportPlaylistsRequest): Promise<PlaylistResult<ExportPlaylistsSummary>> {
   if (request.playlists.length === 0) {
      return Result.err<ExportPlaylistsSummary, PlaylistProblem>(createPlaylistProblem('playlists.export.failed', 'no playlists were selected'));
   }

   return extname(request.destinationPath).toLowerCase() === '.zip' ? exportArchive(request) : exportSingle(request);
}

export async function writePlaylistFile(destinationPath: string, bytes: Uint8Array): Promise<PlaylistResult<number>> {
   const written = await writeFileAtomic(destinationPath, bytes);
   if (Result.isError(written))
      return Result.err<number, PlaylistProblem>(
         createPlaylistProblem('playlists.write.failed', 'the playlist could not be written', { cause: written.error.detail })
      );

   return Result.ok<number, PlaylistProblem>(bytes.byteLength);
}

async function exportSingle(request: ExportPlaylistsRequest): Promise<PlaylistResult<ExportPlaylistsSummary>> {
   const playlist = request.playlists[0];
   if (!playlist) {
      return Result.err<ExportPlaylistsSummary, PlaylistProblem>(createPlaylistProblem('playlists.export.failed', 'no playlists were selected'));
   }

   const content = await readPlaylist(playlist);
   if (Result.isError(content)) return Result.err<ExportPlaylistsSummary, PlaylistProblem>(content.error);

   const written = await writePlaylistFile(request.destinationPath, content.value);
   if (Result.isError(written)) return Result.err<ExportPlaylistsSummary, PlaylistProblem>(written.error);

   request.onProgress?.({ phase: 'writing', current: written.value, total: written.value, percent: 100, unit: 'bytes' });

   return Result.ok<ExportPlaylistsSummary, PlaylistProblem>({
      destinationPath: request.destinationPath,
      playlistCount: 1,
      bytes: written.value,
      files: 1
   });
}

async function exportArchive(request: ExportPlaylistsRequest): Promise<PlaylistResult<ExportPlaylistsSummary>> {
   const files: ZipSourceFile[] = [];
   const usedNames = new Set<string>();
   const totalBytes = request.playlists.reduce((total, playlist) => total + playlist.sizeBytes, 0);
   let bytes = 0;

   for (const playlist of request.playlists) {
      if (request.signal?.aborted) {
         return Result.err<ExportPlaylistsSummary, PlaylistProblem>(createPlaylistProblem('playlists.export.cancelled', 'the export was cancelled'));
      }

      const stats = await Result.tryPromise({
         try: () => stat(playlist.path),
         catch: (cause): PlaylistProblem =>
            createPlaylistProblem('playlists.export.failed', 'a selected playlist could not be read', { fileName: playlist.fileName, cause })
      });
      if (Result.isError(stats)) return Result.err<ExportPlaylistsSummary, PlaylistProblem>(stats.error);

      bytes += stats.value.size;
      if (bytes > maxExportBytes) {
         return Result.err<ExportPlaylistsSummary, PlaylistProblem>(
            createPlaylistProblem('playlists.export.failed', 'the selection is too large to export as one archive', { fileName: playlist.fileName })
         );
      }

      files.push({
         archivePath: claimUniqueArchiveEntryName(toSafePlaylistFileName(playlist.title || playlist.fileName, playlist.id), usedNames),
         sourcePath: playlist.path
      });
      request.onProgress?.({ phase: 'reading', label: playlist.title || playlist.fileName, current: bytes, total: totalBytes, unit: 'bytes' });
   }

   request.onProgress?.({ phase: 'compressing', current: bytes, total: bytes, percent: 100, unit: 'bytes' });

   const written = await writeZipAtomic(request.destinationPath, files, request.signal);
   if (Result.isError(written)) {
      if (request.signal?.aborted) {
         return Result.err<ExportPlaylistsSummary, PlaylistProblem>(createPlaylistProblem('playlists.export.cancelled', 'the export was cancelled'));
      }

      return Result.err<ExportPlaylistsSummary, PlaylistProblem>(
         createPlaylistProblem('playlists.export.failed', 'the archive could not be written', { cause: written.error.detail })
      );
   }

   return Result.ok<ExportPlaylistsSummary, PlaylistProblem>({
      destinationPath: request.destinationPath,
      playlistCount: request.playlists.length,
      bytes,
      files: request.playlists.length
   });
}

function readPlaylist(playlist: LocalPlaylistSummary) {
   return Result.tryPromise({
      try: async () => new Uint8Array(await readFile(playlist.path)),
      catch: (cause): PlaylistProblem =>
         createPlaylistProblem('playlists.export.failed', 'a selected playlist could not be read', { fileName: playlist.fileName, cause })
   });
}
