import { toSafeFileName } from '@/lib/filesystem/path';
import { playlistFileExtension } from '@/modules/playlists/contract';

import { extname, join } from 'node:path';

export const playlistsFolderName = 'Playlists';

export const playlistFileExtensions = [playlistFileExtension, '.json'];

export function playlistsPath(installPath: string) {
   return join(installPath, playlistsFolderName);
}

export function isPlaylistFileName(name: string) {
   return playlistFileExtensions.includes(extname(name).toLowerCase());
}

export function toSafePlaylistFileName(name: string, fallback: string) {
   const base = name.endsWith(playlistFileExtension) ? name.slice(0, -playlistFileExtension.length) : name;

   return `${toSafeFileName(base, fallback)}${playlistFileExtension}`;
}
