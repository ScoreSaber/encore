import { Result } from 'better-result';

import { extractZipArchive } from '@/lib/content/archive-extraction';
import { inspectZipArchive } from '@/lib/content/archive-inspection';
import { buildZipArchive, corruptZipEntryData, patchZipEntryHeaders, type ZipFixtureEntry } from '@/lib/content/zip-archive.fixture';

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('archive extraction', () => {
   test('refuses a destination that already holds files', async () => {
      const staged = await stageArchive([{ name: 'song.dat', data: 'notes' }]);
      await mkdir(staged.destinationPath, { recursive: true });
      await writeFile(join(staged.destinationPath, 'existing.dat'), 'keep me', 'utf8');

      const extracted = await extractZipArchive({ inspection: staged.inspection, destinationPath: staged.destinationPath });

      expect(Result.isError(extracted) && extracted.error.code).toBe('content.extract.destination-not-empty');
      expect(await readFile(join(staged.destinationPath, 'existing.dat'), 'utf8')).toBe('keep me');
   });

   test('rolls back entries whose checksum or declared size is wrong', async () => {
      const archive = buildZipArchive([
         { name: 'first.dat', data: 'first entry' },
         { name: 'second.dat', data: 'second entry' }
      ]);
      const corruptChecksum = await stageArchiveBytes(corruptZipEntryData(archive, 'second entry'));
      const wrongSize = await stageArchiveBytes(patchZipEntryHeaders(buildZipArchive([{ name: 'song.dat', data: 'notes' }]), { declaredSize: 4096 }));

      const checksumResult = await extractZipArchive({
         inspection: corruptChecksum.inspection,
         destinationPath: corruptChecksum.destinationPath
      });
      const sizeResult = await extractZipArchive({ inspection: wrongSize.inspection, destinationPath: wrongSize.destinationPath });

      expect(Result.isError(checksumResult) && checksumResult.error.code).toBe('content.extract.checksum-mismatch');
      expect(Result.isError(sizeResult) && sizeResult.error.code).toBe('content.extract.size-mismatch');
      expect(existsSync(corruptChecksum.destinationPath)).toBe(false);
      expect(existsSync(wrongSize.destinationPath)).toBe(false);
   });
});

async function stageArchive(entries: readonly ZipFixtureEntry[]) {
   return stageArchiveBytes(buildZipArchive(entries));
}

async function stageArchiveBytes(archive: Buffer) {
   const root = await mkdtemp(join(tmpdir(), 'encore-extract-'));
   tempRoots.push(root);

   const archivePath = join(root, 'content.zip');
   await writeFile(archivePath, archive);

   const inspection = await inspectZipArchive({ archivePath });
   if (!Result.isOk(inspection)) throw new Error(`the fixture archive was rejected: ${inspection.error.code}`);

   return { destinationPath: join(root, 'extracted'), inspection: inspection.value };
}
