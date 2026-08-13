import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { archivePathKey, claimUniqueArchiveEntryName, parseArchiveEntryPath } from '@/lib/archive/path';

describe('archive entry paths', () => {
   test('normalizes safe paths and rejects cross-platform escapes and collisions', () => {
      const parsed = parseArchiveEntryPath('./maps//song.dat');
      expect(Result.isOk(parsed) && parsed.value.path).toBe('maps/song.dat');

      for (const name of ['../evil.dat', 'maps/../../evil.dat', 'maps\\..\\..\\evil.dat']) {
         expect(rejectionFor(name)).toBe('traversal');
      }

      for (const name of ['/etc/passwd', '\\\\server\\share\\evil.dat']) {
         expect(rejectionFor(name)).toBe('absolute');
      }

      for (const name of ['C:/evil.dat', 'c:evil.dat']) {
         expect(rejectionFor(name)).toBe('drive');
      }

      for (const name of ['CON', 'maps/NUL.dat', 'maps/LPT1.txt', 'maps/song.dat ', 'maps/song.']) {
         expect(rejectionFor(name)).toBe('reserved-name');
      }

      for (const name of ['maps/song<>.dat', 'maps/song?.dat', 'maps/song\u0000.dat']) {
         expect(rejectionFor(name)).toBe('invalid-character');
      }

      for (const name of ['   ', './']) {
         expect(rejectionFor(name)).toBe('empty');
      }

      const composed = parseArchiveEntryPath('caf\u00e9/song.dat');
      const decomposed = parseArchiveEntryPath('cafe\u0301/song.dat');

      expect(Result.isOk(composed) && Result.isOk(decomposed) && composed.value.path === decomposed.value.path).toBe(true);
      expect(archivePathKey('Maps/Song.dat')).toBe(archivePathKey('maps/song.dat'));
   });

   test('numbers duplicate entry names without moving the extension', () => {
      const usedNames = new Set<string>();

      expect(['Song.bplist', 'song.bplist', 'song.bplist'].map((name) => claimUniqueArchiveEntryName(name, usedNames))).toEqual([
         'Song.bplist',
         'song (2).bplist',
         'song (3).bplist'
      ]);
   });
});

function rejectionFor(name: string) {
   const parsed = parseArchiveEntryPath(name);

   return Result.isError(parsed) ? parsed.error : null;
}
