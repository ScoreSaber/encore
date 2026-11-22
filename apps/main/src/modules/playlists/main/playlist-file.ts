import { Result } from 'better-result';
import { z } from 'zod';

import { causeCode, createProblem } from '@/lib/errors';
import { publishFileExclusive, writeFileAtomic } from '@/lib/filesystem/atomic-write';
import { createUniquePath, removeQuietly, resolveManagedPath } from '@/lib/filesystem/path';
import { playlistFileExtension, type PlaylistProblem, type PlaylistSongRef } from '@/modules/playlists/contract';
import { isPlaylistFileName, toSafePlaylistFileName } from '@/modules/playlists/main/playlist-paths';

import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

export const maxPlaylistBytes = 8 * 1024 * 1024;

const maxPlaylistSongs = 10_000;

const hashPattern = /[\da-f]{40}/i;
const keyPattern = /^[\da-z]{1,16}$/i;

type ParsedPlaylist = {
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
   songs: z.json().default([])
});

export function parsePlaylistDocument(raw: string, fileName: string): Result<ParsedPlaylist, PlaylistProblem> {
   const json = Result.try({
      try: () => z.json().parse(JSON.parse(raw)),
      catch: (cause): PlaylistProblem => createProblem('playlists.file.not-json', { fileName, cause })
   });
   if (Result.isError(json)) return Result.err<ParsedPlaylist, PlaylistProblem>(json.error);

   const parsed = documentSchema.safeParse(json.value);
   if (!parsed.success) {
      return Result.err<ParsedPlaylist, PlaylistProblem>(createProblem('playlists.file.invalid', { fileName, detail: parsed.error.message }));
   }

   const title = parsed.data.playlistTitle?.trim() ?? '';
   if (!title) {
      return Result.err<ParsedPlaylist, PlaylistProblem>(createProblem('playlists.file.no-title', { fileName }));
   }

   const songs = parsed.data.songs;
   if (!Array.isArray(songs)) {
      return Result.err<ParsedPlaylist, PlaylistProblem>(createProblem('playlists.file.invalid-songs', { fileName }));
   }

   return Result.ok<ParsedPlaylist, PlaylistProblem>({
      title,
      author: parsed.data.playlistAuthor?.trim() ?? '',
      description: parsed.data.playlistDescription?.trim() ?? '',
      syncUrl: readSyncUrl(parsed.data.customData?.syncURL),
      songs: readSongs(z.array(songSchema).parse(songs.slice(0, maxPlaylistSongs)))
   });
}

export async function readPlaylistSource(
   path: string,
   fallbackName?: string
): Promise<Result<{ bytes: Uint8Array; title: string }, PlaylistProblem>> {
   const fileName = fallbackName ?? basename(path);

   if (fallbackName === undefined && !isPlaylistFileName(fileName)) {
      return Result.err(createProblem('playlists.file.invalid', { fileName }));
   }

   const stats = await Result.tryPromise({
      try: () => stat(path),
      catch: (cause) => createProblem('playlists.source.unreadable', { fileName, cause })
   });
   if (Result.isError(stats)) return Result.err(stats.error);

   if (!stats.value.isFile() || stats.value.size > maxPlaylistBytes) {
      return Result.err(createProblem('playlists.file.too-large', { fileName }));
   }

   const raw = await Result.tryPromise({
      try: () => readFile(path),
      catch: (cause) => createProblem('playlists.source.unreadable', { fileName, cause })
   });
   if (Result.isError(raw)) return Result.err(raw.error);

   return Result.map(parsePlaylistDocument(raw.value.toString('utf8'), fileName), ({ title }) => ({ bytes: new Uint8Array(raw.value), title }));
}

export async function installPlaylist(rootPath: string, bytes: Uint8Array, title: string, fallbackName: string) {
   const fallback = basename(fallbackName, extname(fallbackName)) || 'playlist';
   const desiredPath = join(rootPath, toSafePlaylistFileName(title || fallback, fallback));
   const failed = (cause: unknown): PlaylistProblem => createProblem('playlists.write.failed', { fileName: fallback, cause });

   const partialPath = `${desiredPath}.${randomUUID()}.part`;
   const written = await Result.tryPromise({ try: () => writeFile(partialPath, bytes), catch: (cause) => cause });
   const placed = Result.isOk(written) ? await linkUniquePlaylist(rootPath, desiredPath, partialPath) : written;
   await removeQuietly(partialPath);

   return placed.map(() => bytes.byteLength).mapError(failed);
}

async function linkUniquePlaylist(rootPath: string, desiredPath: string, partialPath: string) {
   for (;;) {
      const target = await Result.gen(async function* () {
         const unique = yield* Result.await(createUniquePath(desiredPath, playlistFileExtension));
         return resolveManagedPath({ root: rootPath, path: unique });
      });
      if (Result.isError(target)) return Result.err(target.error);

      const linked = await Result.tryPromise({ try: () => publishFileExclusive(partialPath, target.value.path), catch: (cause) => cause });
      if (Result.isOk(linked) || causeCode(linked.error) !== 'EEXIST') return linked;
   }
}

export async function writePlaylistFile(destinationPath: string, bytes: Uint8Array): Promise<Result<number, PlaylistProblem>> {
   const written = await writeFileAtomic(destinationPath, bytes);
   return written.map(() => bytes.byteLength).mapError((cause): PlaylistProblem => createProblem('playlists.write.failed', { detail: cause.detail }));
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
