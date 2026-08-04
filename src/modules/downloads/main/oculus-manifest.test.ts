import { Result } from 'better-result';

import {
   maxManifestFiles,
   maxManifestTotalBytes,
   maxSegmentBytes,
   oculusManifestFileSchema,
   oculusManifestSchema,
   parseOculusManifest,
   readZipEntry
} from '@/modules/downloads/main/oculus-manifest';
import { createZipArchive } from '@/modules/downloads/main/oculus-manifest.fixture';

import { describe, expect, test } from 'bun:test';

describe('oculus manifest', () => {
   test('bounds declared and inflated manifest sizes', () => {
      const declared = archiveWithManifest('{"files":{}}');
      const archive = createZipArchive([{ name: 'manifest.json', content: Buffer.alloc(64 * 1024, 0) }]);

      expect(Result.isError(readZipEntry(declared, 'manifest.json', 4))).toBe(true);
      expect(Result.isError(readZipEntry(archive, 'manifest.json', 1024))).toBe(true);
   });

   test('parses the file list and rejects anything else', () => {
      const manifest = { files: { 'Beat Saber.exe': { sha256: 'abc', size: 4, segments: [[0, 'seg', 4]] } } };
      const parsed = parseOculusManifest(archiveWithManifest(JSON.stringify(manifest)));

      expect(Result.isOk(parsed) ? parsed.value.files['Beat Saber.exe'] : null).toMatchObject({ sha256: 'abc', size: 4 });
      expect(Result.isError(parseOculusManifest(archiveWithManifest('{"files":3}')))).toBe(true);
      expect(Result.isError(parseOculusManifest(archiveWithManifest('nope')))).toBe(true);
   });

   test('rejects excessive manifest cardinality and declared sizes', () => {
      const file = { sha256: 'abc', size: 0, segments: [] };
      const tooManyFiles = Object.fromEntries(Array.from({ length: maxManifestFiles + 1 }, (_, index) => [`file-${index}`, file]));

      expect(oculusManifestSchema.safeParse({ files: tooManyFiles }).success).toBe(false);
      expect(oculusManifestSchema.safeParse({ files: { huge: { ...file, size: maxManifestTotalBytes + 1 } } }).success).toBe(false);
      expect(oculusManifestSchema.safeParse({ files: { huge: { ...file, segments: [[0, 'segment', maxSegmentBytes + 1]] } } }).success).toBe(false);
      expect(oculusManifestFileSchema.safeParse({ ...file, size: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
   });
});

function archiveWithManifest(content: string) {
   return createZipArchive([{ name: 'manifest.json', content: Buffer.from(content, 'utf8') }]);
}
