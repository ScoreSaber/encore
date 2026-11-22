import { Result } from 'better-result';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { z } from 'zod';

import { copyPathWithProgress, deletePathWithProgress, movePathWithProgress } from '@/lib/filesystem/operations';
import { resolveManagedPath } from '@/lib/filesystem/path';

import { existsSync } from 'node:fs';
import { link, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock(import('node:fs/promises'), async (importOriginal) => {
   const actual = await importOriginal();
   return { ...actual, link: vi.fn(actual.link) };
});

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

test('keeps managed writes inside their root', async () => {
   const root = await createTempRoot();
   const outside = await createTempRoot();
   const precious = join(outside, 'precious.txt');
   const mods = join(root, 'install', 'Mods');
   await writeFile(precious, 'outside', 'utf8');
   await mkdir(mods, { recursive: true });
   await writeFile(join(mods, 'mod.dll'), 'mod', 'utf8');

   expect(Result.isError(await resolveManagedPath({ root, path: join(root, '..', 'outside') }))).toBe(true);
   expect(Result.isError(await resolveManagedPath({ root, path: root }))).toBe(true);

   const copiedIntoSelf = await copyPathWithProgress({
      sourcePath: mods,
      sourceRoot: root,
      destinationPath: join(root, 'install'),
      destinationRoot: root,
      overwrite: true
   });
   expect(Result.isError(copiedIntoSelf) && copiedIntoSelf.error.code).toBe('filesystem.path.copy-into-self');
   expect(await readFile(join(mods, 'mod.dll'), 'utf8')).toBe('mod');

   const linked = await Result.tryPromise({ try: () => symlink(outside, join(root, 'escape'), 'dir'), catch: (cause) => cause });
   if (Result.isError(linked) && z.object({ code: z.enum(['EPERM', 'EACCES']) }).safeParse(linked.error).success) return;
   if (Result.isError(linked)) throw linked.error;

   const deleted = await deletePathWithProgress({ targetPath: join(root, 'escape', 'precious.txt'), root });
   expect(Result.isError(deleted)).toBe(true);
   expect(await readFile(precious, 'utf8')).toBe('outside');
});

test('keeps the existing destination when an overwrite copy is cancelled', async () => {
   const root = await createTempRoot();
   const destination = join(root, 'destination.dat');
   const controller = new AbortController();
   await writeFile(join(root, 'source.dat'), 'new', 'utf8');
   await writeFile(destination, 'old', 'utf8');

   const result = await copyPathWithProgress({
      sourcePath: join(root, 'source.dat'),
      destinationPath: destination,
      destinationRoot: root,
      overwrite: true,
      signal: controller.signal,
      onProgress: () => controller.abort()
   });

   expect(Result.isError(result)).toBe(true);
   expect(await readFile(destination, 'utf8')).toBe('old');
});

test('publishes a moved directory only once it is complete', async () => {
   const root = await createTempRoot();
   const source = join(root, 'source', 'Map');
   const destination = join(root, 'shared', 'Map');
   await mkdir(source, { recursive: true });
   await writeFile(join(source, 'Info.dat'), 'info', 'utf8');
   await writeFile(join(source, 'song.egg'), 'song', 'utf8');
   let publishedMidCopy: boolean | null = null;

   const moved = await movePathWithProgress({
      sourcePath: source,
      sourceRoot: root,
      destinationPath: destination,
      destinationRoot: root,
      onProgress: () => {
         publishedMidCopy ??= existsSync(destination);
      }
   });

   expect(Result.isOk(moved)).toBe(true);
   expect(publishedMidCopy).toBe(false);
   expect((await readdir(destination)).toSorted()).toEqual(['Info.dat', 'song.egg']);
   expect(await readdir(join(root, 'shared'))).toEqual(['Map']);
});

test('publishes files on filesystems that lack hard links', async () => {
   const root = await createTempRoot();
   await writeFile(join(root, 'model.saber'), 'model', 'utf8');
   vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }));

   const copied = await copyPathWithProgress({
      sourcePath: join(root, 'model.saber'),
      sourceRoot: root,
      destinationPath: join(root, 'Sabers', 'model.saber'),
      destinationRoot: root
   });

   expect(Result.isOk(copied)).toBe(true);
   expect(await readFile(join(root, 'Sabers', 'model.saber'), 'utf8')).toBe('model');
   expect(await readdir(join(root, 'Sabers'))).toEqual(['model.saber']);
});

async function createTempRoot() {
   const tempRoot = await mkdtemp(join(tmpdir(), 'encore-fs-'));
   tempRoots.push(tempRoot);
   return tempRoot;
}
