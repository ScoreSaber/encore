import { Result } from 'better-result';
import { afterEach, expect, test } from 'vite-plus/test';

import { buildZipArchive, type ZipFixtureEntry } from '@/lib/archive/zip-read.fixture';
import { inspectZipArchive } from '@/lib/content/archive-inspection';
import type { ContentLimits } from '@/lib/content/content-limits';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

test('refuses archives that could write outside the destination or explode on extraction', async () => {
   for (const name of [
      '../evil.dat',
      'maps/../../evil.dat',
      'maps\\..\\..\\evil.dat',
      '/etc/passwd',
      '\\\\server\\share\\evil.dat',
      'C:/evil.dat',
      'maps/NUL.dat'
   ]) {
      expect(await problemFor([{ name, data: 'evil' }])).toBe('content.archive.path-rejected');
   }

   expect(await problemFor([{ name: 'shortcut', data: '/etc/passwd', unixMode: 0o120777 }])).toBe('content.archive.unsupported-entry');
   expect(await problemFor([{ name: 'shortcut', data: 'C:/Windows', msdosAttributes: 0x400 }])).toBe('content.archive.unsupported-entry');
   expect(
      await problemFor([
         { name: 'Maps/Song.dat', data: 'first' },
         { name: 'maps/song.dat', data: 'second' }
      ])
   ).toBe('content.archive.duplicate-entry');
   expect(
      await problemFor([{ name: 'bomb.dat', data: Buffer.alloc(256 * 1024, 'a'), deflate: true }], { ratioFloorBytes: 128, maxCompressionRatio: 20 })
   ).toBe('content.archive.entry-ratio-exceeded');
});

async function problemFor(entries: readonly ZipFixtureEntry[], limits?: Partial<ContentLimits>) {
   const root = await mkdtemp(join(tmpdir(), 'encore-archive-'));
   tempRoots.push(root);
   const archivePath = join(root, 'content.zip');
   await writeFile(archivePath, buildZipArchive(entries));

   const inspection = await inspectZipArchive({ archivePath, limits });
   return Result.isError(inspection) ? inspection.error.code : 'accepted';
}
