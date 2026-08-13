import { Result } from 'better-result';
import { z } from 'zod';

import type { PlaylistProblem, PlaylistSongRef } from '@/modules/playlists/contract';
import { createPlaylistProblem, type PlaylistResult } from '@/modules/playlists/main/playlist-problem';

export const maxPlaylistBytes = 8 * 1024 * 1024;

const maxPlaylistSongs = 10_000;

const hashPattern = /[\da-f]{40}/i;
const keyPattern = /^[\da-z]{1,16}$/i;

export type ParsedPlaylist = {
   title: string;
   author: string;
   description: string;
   syncUrl: string | null;
   songs: PlaylistSongRef[];
};

const difficultySchema = z.object({ name: z.string().optional(), characteristic: z.string().optional() }).nullable().catch(null);

const songSchema = z
   .object({
      hash: z.string().optional(),
      key: z.string().optional(),
      levelid: z.string().optional(),
      levelId: z.string().optional(),
      songName: z.string().optional(),
      levelAuthorName: z.string().optional(),
      difficulties: z.array(difficultySchema).optional()
   })
   .nullable()
   .catch(null);

const documentSchema = z.object({
   playlistTitle: z.string().optional(),
   playlistAuthor: z.string().optional(),
   playlistDescription: z.string().optional(),
   customData: z.object({ syncURL: z.string().optional() }).nullable().optional().catch(null),
   songs: z.json().optional()
});

export function parsePlaylistDocument(raw: string, fileName: string): PlaylistResult<ParsedPlaylist> {
   const json = Result.try({
      try: () => z.json().parse(JSON.parse(raw)),
      catch: (cause): PlaylistProblem => createPlaylistProblem('playlists.file.invalid', 'this file is not readable json', { fileName, cause })
   });
   if (Result.isError(json)) return Result.err<ParsedPlaylist, PlaylistProblem>(json.error);

   const parsed = documentSchema.safeParse(json.value);
   if (!parsed.success) {
      return Result.err<ParsedPlaylist, PlaylistProblem>(
         createPlaylistProblem('playlists.file.invalid', 'this file is not a playlist', { fileName, cause: parsed.error.message })
      );
   }

   const title = parsed.data.playlistTitle?.trim() ?? '';
   if (!title) {
      return Result.err<ParsedPlaylist, PlaylistProblem>(createPlaylistProblem('playlists.file.invalid', 'this playlist has no title', { fileName }));
   }

   const songs = parseSongs(parsed.data.songs, fileName);
   if (Result.isError(songs)) return Result.err<ParsedPlaylist, PlaylistProblem>(songs.error);

   return Result.ok<ParsedPlaylist, PlaylistProblem>({
      title,
      author: parsed.data.playlistAuthor?.trim() ?? '',
      description: parsed.data.playlistDescription?.trim() ?? '',
      syncUrl: readSyncUrl(parsed.data.customData?.syncURL),
      songs: readSongs(songs.value)
   });
}

function parseSongs(value: z.infer<ReturnType<typeof z.json>> | undefined, fileName: string): PlaylistResult<z.infer<typeof songSchema>[]> {
   if (value === undefined) return Result.ok<z.infer<typeof songSchema>[], PlaylistProblem>([]);
   if (!Array.isArray(value)) {
      return Result.err<z.infer<typeof songSchema>[], PlaylistProblem>(
         createPlaylistProblem('playlists.file.invalid', 'this playlist has an invalid song list', { fileName })
      );
   }

   const parsed = z.array(songSchema).safeParse(value.slice(0, maxPlaylistSongs));
   return parsed.success
      ? Result.ok<z.infer<typeof songSchema>[], PlaylistProblem>(parsed.data)
      : Result.err<z.infer<typeof songSchema>[], PlaylistProblem>(
           createPlaylistProblem('playlists.file.invalid', 'this playlist has an invalid song list', { fileName })
        );
}

function readSongs(songs: z.infer<typeof songSchema>[]): PlaylistSongRef[] {
   return songs.flatMap((song) => {
      if (!song) return [];

      const hash = readHash(song.hash ?? song.levelid ?? song.levelId);
      const key = song.key?.trim().toLowerCase();

      return [
         {
            hash,
            key: key && keyPattern.test(key) ? key : null,
            songName: song.songName?.trim() ?? '',
            levelAuthorName: song.levelAuthorName?.trim() ?? '',
            difficulties: (song.difficulties ?? []).flatMap((difficulty) =>
               difficulty ? [{ characteristic: difficulty.characteristic ?? 'Standard', difficulty: difficulty.name ?? 'Unknown' }] : []
            ),
            installed: false
         }
      ];
   });
}

function readHash(value: string | undefined) {
   const found = value ? hashPattern.exec(value) : null;

   return found ? found[0].toLowerCase() : null;
}

function readSyncUrl(value: string | undefined) {
   const trimmed = value?.trim();
   if (!trimmed || !URL.canParse(trimmed)) return null;

   return new URL(trimmed).protocol === 'https:' ? trimmed : null;
}
