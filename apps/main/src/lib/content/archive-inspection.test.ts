import { Result } from 'better-result';

import { inspectZipArchive, type ArchiveInspection } from '@/lib/content/archive-inspection';
import type { ContentLimits } from '@/lib/content/content-limits';
import {
   buildCompressibleBuffer,
   buildZipArchive,
   patchZipEntryHeaders,
   truncateZipArchive,
   type ZipFixtureEntry
} from '@/lib/content/zip-archive.fixture';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];
const symbolicLinkMode = 0o120777;
const characterDeviceMode = 0o020666;
const regularFileMode = 0o100644;
const msdosReparsePoint = 0x400;

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('archive inspection', () => {
   test('refuses paths that escape or cannot be written cross-platform', async () => {
      for (const name of [
         '../evil.dat',
         'maps/../../evil.dat',
         '/etc/passwd',
         'C:/evil.dat',
         'maps\\..\\..\\evil.dat',
         'maps/CON.dat',
         'maps/song.dat ',
         'maps/song.'
      ]) {
         expect(await problemFor([{ name, data: 'evil' }])).toBe('content.archive.path-rejected');
      }
   });

   test('refuses special entries and path collisions', async () => {
      const symbolicLink = await problemFor([
         { name: 'song.dat', data: 'notes', unixMode: regularFileMode },
         { name: 'shortcut', data: '/etc/passwd', unixMode: symbolicLinkMode }
      ]);
      const device = await problemFor([{ name: 'node', data: '', unixMode: characterDeviceMode }]);
      const reparsePoint = await problemFor([{ name: 'shortcut', data: 'C:/Windows', msdosAttributes: msdosReparsePoint }]);
      const caseOnly = await problemFor([
         { name: 'Maps/Song.dat', data: 'first' },
         { name: 'maps/song.dat', data: 'second' }
      ]);
      const unicode = await problemFor([
         { name: 'caf\u00e9.dat', data: 'first' },
         { name: 'cafe\u0301.dat', data: 'second' }
      ]);
      const fileAndFolder = await problemFor([
         { name: 'data', data: 'first' },
         { name: 'data/song.dat', data: 'second' }
      ]);

      expect([symbolicLink, device, reparsePoint]).toEqual([
         'content.archive.unsupported-entry',
         'content.archive.unsupported-entry',
         'content.archive.unsupported-entry'
      ]);
      expect([caseOnly, unicode, fileAndFolder]).toEqual([
         'content.archive.duplicate-entry',
         'content.archive.duplicate-entry',
         'content.archive.duplicate-entry'
      ]);
   });

   test('accepts Unix entries that contain permission bits without file type bits', async () => {
      const inspection = await inspectArchive([{ name: 'Plugins/BeatSaverDownloader.dll', data: 'plugin', unixMode: 0o644 }]);

      expect(Result.isOk(inspection)).toBe(true);
      if (Result.isOk(inspection)) expect(inspection.value.manifest.rootEntries).toEqual(['Plugins']);
   });

   test('enforces archive path, entry, size and compression limits', async () => {
      const long = await problemFor([{ name: `${'a'.repeat(220)}.dat`, data: 'notes' }]);
      const deep = await problemFor([{ name: `${Array.from({ length: 15 }, (_value, index) => `d${index}`).join('/')}/song.dat`, data: 'notes' }]);
      const entries = Array.from({ length: 12 }, (_value, index) => ({ name: `song-${index}.dat`, data: 'notes' }));
      const large = [{ name: 'song.dat', data: 'a'.repeat(4096) }];
      const compressed = [{ name: 'bomb.dat', data: buildCompressibleBuffer(256 * 1024), deflate: true }];

      expect([long, deep]).toEqual(['content.archive.path-too-long', 'content.archive.path-too-long']);
      expect(await problemFor(entries, { maxEntries: 8 })).toBe('content.archive.too-many-entries');
      expect(await problemFor(large, { maxArchiveBytes: 64 })).toBe('content.archive.too-large');
      expect(await problemFor(large, { maxTotalBytes: 1024 })).toBe('content.archive.too-large');
      expect(await problemFor(large, { maxEntryBytes: 1024 })).toBe('content.archive.too-large');
      expect(await problemFor(compressed, { ratioFloorBytes: 128, maxCompressionRatio: 20 })).toBe('content.archive.ratio-exceeded');
   });

   test('refuses encrypted, unsupported and corrupt archives', async () => {
      const archive = buildZipArchive([{ name: 'song.dat', data: 'notes' }]);

      expect(await problemForArchive(patchZipEntryHeaders(archive, { addFlags: 0x1 }))).toBe('content.archive.encrypted');
      expect(await problemForArchive(patchZipEntryHeaders(archive, { compressionMethod: 12 }))).toBe('content.archive.unsupported-compression');
      expect(await problemForArchive(Buffer.from('this is not a zip archive'))).toBe('content.archive.not-zip');
      expect(await problemForArchive(truncateZipArchive(archive))).toBe('content.archive.not-zip');
      expect(await problemForArchive(buildZipArchive([]))).toBe('content.archive.corrupt');
   });
});

async function inspectArchive(entries: readonly ZipFixtureEntry[], limits?: Partial<ContentLimits>) {
   return inspectArchiveBytes(buildZipArchive(entries), limits);
}

async function inspectArchiveBytes(archive: Buffer, limits?: Partial<ContentLimits>) {
   const archivePath = join(await createTempRoot(), 'content.zip');
   await writeFile(archivePath, archive);

   return inspectZipArchive({ archivePath, limits });
}

async function problemFor(entries: readonly ZipFixtureEntry[], limits?: Partial<ContentLimits>) {
   return problemCode(await inspectArchive(entries, limits));
}

async function problemForArchive(archive: Buffer, limits?: Partial<ContentLimits>) {
   return problemCode(await inspectArchiveBytes(archive, limits));
}

function problemCode(inspection: Awaited<ReturnType<typeof inspectZipArchive>>) {
   return Result.isError(inspection) ? inspection.error.code : `unexpected success: ${describeInspection(inspection.value)}`;
}

function describeInspection(inspection: ArchiveInspection) {
   return inspection.entries.map((entry) => entry.path).join(', ');
}

async function createTempRoot() {
   const root = await mkdtemp(join(tmpdir(), 'encore-archive-'));
   tempRoots.push(root);

   return root;
}
