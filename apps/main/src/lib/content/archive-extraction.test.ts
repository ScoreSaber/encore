import { Result } from 'better-result';
import { afterEach, expect, test } from 'vite-plus/test';

import { buildZipArchive } from '@/lib/archive/zip-read.fixture';
import { extractZipArchive } from '@/lib/content/archive-extraction';
import { inspectZipArchive } from '@/lib/content/archive-inspection';

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

test('refuses to extract over a destination that already holds files', async () => {
   const root = await mkdtemp(join(tmpdir(), 'encore-extract-'));
   tempRoots.push(root);
   const archivePath = join(root, 'content.zip');
   const destinationPath = join(root, 'extracted');
   await writeFile(archivePath, buildZipArchive([{ name: 'existing.dat', data: 'notes' }]));
   await mkdir(destinationPath);
   await writeFile(join(destinationPath, 'existing.dat'), 'keep me', 'utf8');

   const inspection = await inspectZipArchive({ archivePath });
   if (Result.isError(inspection)) throw new Error(inspection.error.code);
   const extracted = await extractZipArchive({ inspection: inspection.value, destinationPath });

   expect(Result.isError(extracted) && extracted.error.code).toBe('content.extract.destination-not-empty');
   expect(await readFile(join(destinationPath, 'existing.dat'), 'utf8')).toBe('keep me');
});
