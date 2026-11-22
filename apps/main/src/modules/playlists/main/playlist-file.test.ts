import { expect, onTestFinished, test } from 'vite-plus/test';

import { installPlaylist } from '@/modules/playlists/main/playlist-file';

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keeps both playlists when two same-title imports publish at once', async () => {
   const root = await mkdtemp(join(tmpdir(), 'encore-playlists-'));
   onTestFinished(() => rm(root, { recursive: true, force: true }));
   const playlists = ['first', 'second'].map((author) => JSON.stringify({ playlistTitle: 'Ranked', playlistAuthor: author, songs: [] }));

   const installed = await Promise.all(
      playlists.map((playlist) => installPlaylist(root, new TextEncoder().encode(playlist), 'Ranked', 'download.bplist'))
   );

   expect(installed.every((result) => result.isOk())).toBe(true);
   const files = (await readdir(root)).toSorted();
   expect(files).toEqual(['Ranked (1).bplist', 'Ranked.bplist']);
   const contents = await Promise.all(files.map((file) => readFile(join(root, file), 'utf8')));
   expect(contents.toSorted()).toEqual(playlists);
});
