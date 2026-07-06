import { Result } from 'better-result';
import { z } from 'zod';

import { copyPathWithProgress, deletePathWithProgress, movePathWithProgress } from '@/main/filesystem/file-operations';
import { pathExists, readPathInfo } from '@/main/filesystem/path-helpers';
import { readJsonFile, writeJsonFileAtomic } from '@/main/filesystem/safe-json';
import { createMemoryWriteAuditLog } from '@/main/filesystem/write-audit';
import { createOperationRegistry } from '@/main/operations/operation-registry';

import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const metadataSchema = z.object({
   name: z.string(),
   version: z.number()
});
const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('filesystem write operations', () => {
   test('copies directories with operation progress and audit entries', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      const registry = createOperationRegistry();
      const operation = registry.create({
         kind: 'copy',
         title: 'Copy test'
      });
      const audit = createMemoryWriteAuditLog();

      await mkdir(source);
      await writeFile(join(source, 'song.dat'), 'beats', 'utf8');

      const result = await copyPathWithProgress({
         sourcePath: source,
         destinationPath: destination,
         destinationRoot: root,
         operation: {
            registry,
            operationId: operation.id
         },
         audit: audit.write
      });

      expect(Result.isOk(result)).toBe(true);
      expect(await readFile(join(destination, 'song.dat'), 'utf8')).toBe('beats');
      expect(registry.list()[0]?.progress?.percent).toBe(100);
      expect(audit.list().map((entry) => entry.status)).toEqual(['started', 'completed']);
   });

   test('cleans temporary copy output when cancellation interrupts a write', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      const controller = new AbortController();
      let cancelled = false;

      await mkdir(source);
      await writeFile(join(source, 'first.dat'), 'first', 'utf8');
      await writeFile(join(source, 'second.dat'), 'second', 'utf8');

      const result = await copyPathWithProgress({
         sourcePath: source,
         destinationPath: destination,
         destinationRoot: root,
         signal: controller.signal,
         onProgress: () => {
            if (cancelled) return;
            cancelled = true;
            controller.abort();
         }
      });
      const destinationExists = await pathExists(destination);

      expect(Result.isError(result)).toBe(true);
      expect(Result.isOk(destinationExists)).toBe(true);
      if (Result.isOk(destinationExists)) expect(destinationExists.value).toBe(false);
   });

   test('copies directory links without flattening their target contents', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source');
      const sharedTarget = join(root, 'shared-target');
      const sourceLink = join(source, 'LinkedContent');
      const destination = join(root, 'destination');

      await mkdir(source);
      await mkdir(sharedTarget);
      await writeFile(join(sharedTarget, 'shared.dat'), 'shared', 'utf8');
      if (!(await createTestSymlink(sharedTarget, sourceLink, process.platform === 'win32' ? 'junction' : 'dir'))) return;

      const result = await copyPathWithProgress({
         sourcePath: source,
         destinationPath: destination,
         destinationRoot: root
      });
      const copiedLinkInfo = await readPathInfo(join(destination, 'LinkedContent'));

      expect(Result.isOk(result)).toBe(true);
      expect(Result.isOk(copiedLinkInfo)).toBe(true);
      if (Result.isOk(copiedLinkInfo)) expect(copiedLinkInfo.value.kind).toBe('link');
      expect(await readFile(join(destination, 'LinkedContent', 'shared.dat'), 'utf8')).toBe('shared');
   });

   test('moves paths through copy and source cleanup', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source');
      const destination = join(root, 'destination');

      await mkdir(source);
      await writeFile(join(source, 'song.dat'), 'beats', 'utf8');

      const result = await movePathWithProgress({
         sourcePath: source,
         sourceRoot: root,
         destinationPath: destination,
         destinationRoot: root
      });
      const sourceExists = await pathExists(source);

      expect(Result.isOk(result)).toBe(true);
      expect(Result.isOk(sourceExists)).toBe(true);
      if (Result.isOk(sourceExists)) expect(sourceExists.value).toBe(false);
      expect(await readFile(join(destination, 'song.dat'), 'utf8')).toBe('beats');
   });

   test('keeps the destination copy when a move is cancelled during source cleanup', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source');
      const destination = join(root, 'destination');
      const controller = new AbortController();
      let cancelled = false;

      await mkdir(source);
      await writeFile(join(source, 'first.dat'), 'first', 'utf8');
      await writeFile(join(source, 'second.dat'), 'second', 'utf8');

      const result = await movePathWithProgress({
         sourcePath: source,
         sourceRoot: root,
         destinationPath: destination,
         destinationRoot: root,
         signal: controller.signal,
         onProgress: (progress) => {
            if (progress.phase !== 'deleting' || cancelled) return;
            cancelled = true;
            controller.abort();
         }
      });

      expect(Result.isError(result)).toBe(true);
      expect(await readFile(join(destination, 'first.dat'), 'utf8')).toBe('first');
      expect(await readFile(join(destination, 'second.dat'), 'utf8')).toBe('second');
   });

   test('does not replace an existing destination when a single-file overwrite copy is cancelled after copying', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source.dat');
      const destination = join(root, 'destination.dat');
      const controller = new AbortController();

      await writeFile(source, 'new', 'utf8');
      await writeFile(destination, 'old', 'utf8');

      const result = await copyPathWithProgress({
         sourcePath: source,
         destinationPath: destination,
         destinationRoot: root,
         overwrite: true,
         signal: controller.signal,
         onProgress: () => controller.abort()
      });

      expect(Result.isError(result)).toBe(true);
      expect(await readFile(destination, 'utf8')).toBe('old');
   });

   test('does not clobber a destination created during a no-overwrite file copy', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source.dat');
      const destination = join(root, 'destination.dat');
      let raced = false;

      await writeFile(source, 'source', 'utf8');

      const result = await copyPathWithProgress({
         sourcePath: source,
         destinationPath: destination,
         destinationRoot: root,
         onProgress: () => {
            if (raced) return;
            raced = true;
            writeFileSync(destination, 'raced', 'utf8');
         }
      });

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error.code).toBe('filesystem.operation.destination-exists');
      expect(await readFile(destination, 'utf8')).toBe('raced');
   });

   test('rejects overwrite copies where the destination contains the source', async () => {
      const root = await createTempRoot();
      const install = join(root, 'install');
      const mods = join(install, 'Mods');

      await mkdir(mods, { recursive: true });
      await writeFile(join(mods, 'mod.dll'), 'mod', 'utf8');

      const result = await copyPathWithProgress({
         sourcePath: mods,
         sourceRoot: root,
         destinationPath: install,
         destinationRoot: root,
         overwrite: true
      });

      expect(Result.isError(result)).toBe(true);
      if (Result.isError(result)) expect(result.error.code).toBe('filesystem.path.copy-into-self');
      expect(await readFile(join(mods, 'mod.dll'), 'utf8')).toBe('mod');
   });

   test('rejects case-only moves that resolve to the same path on case-insensitive macOS volumes', async () => {
      if (process.platform !== 'darwin') return;

      const root = await createTempRoot();
      const source = join(root, 'foo');
      const destination = join(root, 'Foo');

      await writeFile(source, 'case', 'utf8');

      const result = await movePathWithProgress({
         sourcePath: source,
         sourceRoot: root,
         destinationPath: destination,
         destinationRoot: root,
         overwrite: true
      });

      expect(Result.isError(result)).toBe(true);
      expect(await readFile(source, 'utf8')).toBe('case');
   });

   test('deletes only paths inside the managed root', async () => {
      const root = await createTempRoot();
      const target = join(root, 'target');
      const outside = join(root, '..', 'outside');

      await mkdir(target);
      await writeFile(join(target, 'song.dat'), 'beats', 'utf8');

      const deleted = await deletePathWithProgress({
         targetPath: target,
         root
      });
      const blocked = await deletePathWithProgress({
         targetPath: outside,
         root
      });

      expect(Result.isOk(deleted)).toBe(true);
      expect(Result.isError(blocked)).toBe(true);
   });

   test('does not delete outside files through a symlinked directory inside the managed root', async () => {
      const root = await createTempRoot();
      const outside = await createTempRoot();
      const escape = join(root, 'escape');
      const precious = join(outside, 'precious.txt');

      await writeFile(precious, 'outside', 'utf8');
      if (!(await createTestSymlink(outside, escape, 'dir'))) return;

      const result = await deletePathWithProgress({
         targetPath: join(escape, 'precious.txt'),
         root
      });

      expect(Result.isError(result)).toBe(true);
      expect(await readFile(precious, 'utf8')).toBe('outside');
   });

   test('deletes dangling symlinks instead of treating them as missing', async () => {
      const root = await createTempRoot();
      const linkPath = join(root, 'dangling-link');

      if (!(await createTestSymlink(join(root, 'missing-target'), linkPath))) return;

      const result = await deletePathWithProgress({
         targetPath: linkPath,
         root
      });
      const exists = await pathExists(linkPath);

      expect(Result.isOk(result)).toBe(true);
      expect(Result.isOk(exists)).toBe(true);
      if (Result.isOk(exists)) expect(exists.value).toBe(false);
   });

   test('fails missing and empty paths before starting audited writes', async () => {
      const root = await createTempRoot();
      const audit = createMemoryWriteAuditLog();

      const missingCopy = await copyPathWithProgress({
         sourcePath: join(root, 'missing'),
         destinationPath: join(root, 'destination'),
         destinationRoot: root,
         audit: audit.write
      });
      const emptyCopy = await copyPathWithProgress({
         sourcePath: '',
         destinationPath: join(root, 'destination'),
         destinationRoot: root,
         audit: audit.write
      });
      const missingDelete = await deletePathWithProgress({
         targetPath: join(root, 'missing'),
         root,
         audit: audit.write
      });

      expect(Result.isError(missingCopy)).toBe(true);
      if (Result.isError(missingCopy)) expect(missingCopy.error.code).toBe('filesystem.path.not-found');
      expect(Result.isError(emptyCopy)).toBe(true);
      if (Result.isError(emptyCopy)) expect(emptyCopy.error.code).toBe('filesystem.path.empty');
      expect(Result.isError(missingDelete)).toBe(true);
      if (Result.isError(missingDelete)) expect(missingDelete.error.code).toBe('filesystem.path.not-found');
      expect(audit.list()).toEqual([]);
   });

   test('keeps writes inside the Result contract when audit sinks reject', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source.dat');
      const destination = join(root, 'destination.dat');

      await writeFile(source, 'source', 'utf8');

      const result = await copyPathWithProgress({
         sourcePath: source,
         destinationPath: destination,
         destinationRoot: root,
         audit: async () => {
            throw new Error('audit unavailable');
         }
      });

      expect(Result.isOk(result)).toBe(true);
      expect(await readFile(destination, 'utf8')).toBe('source');
   });
});

describe('safe JSON helpers', () => {
   test('round-trips schema-validated JSON with atomic replacement', async () => {
      const root = await createTempRoot();
      const filePath = join(root, 'metadata.json');
      const audit = createMemoryWriteAuditLog();

      const written = await writeJsonFileAtomic(filePath, { name: 'Encore', version: 1 }, metadataSchema, {
         root,
         audit: audit.write,
         scope: 'settings'
      });
      const read = await readJsonFile(filePath, metadataSchema);

      expect(Result.isOk(written)).toBe(true);
      expect(Result.isOk(read)).toBe(true);
      if (Result.isOk(read)) expect(read.value.name).toBe('Encore');
      expect(audit.list().map((entry) => entry.status)).toEqual(['started', 'completed']);
   });

   test('rejects invalid JSON writes without truncating the previous file', async () => {
      const root = await createTempRoot();
      const filePath = join(root, 'metadata.json');

      await writeJsonFileAtomic(filePath, { name: 'Encore', version: 1 }, metadataSchema, { root });
      const invalid = await writeJsonFileAtomic(filePath, { name: 'Encore', version: 'bad' }, metadataSchema, { root });

      expect(Result.isError(invalid)).toBe(true);
      expect(await readFile(filePath, 'utf8')).toContain('"version": 1');
   });
});

async function createTempRoot() {
   const tempRoot = await mkdtemp(join(tmpdir(), 'encore-fs-'));
   tempRoots.push(tempRoot);
   return tempRoot;
}

async function createTestSymlink(target: string, path: string, type?: 'dir' | 'file' | 'junction') {
   const result = await Result.tryPromise({
      try: async () => {
         await symlink(target, path, type);
      },
      catch: (cause: unknown) => cause
   });

   if (Result.isOk(result)) return true;
   if (isSymlinkPrivilegeError(result.error)) return false;
   throw result.error;
}

function isSymlinkPrivilegeError(cause: unknown) {
   return cause instanceof Error && 'code' in cause && typeof cause.code === 'string' && (cause.code === 'EPERM' || cause.code === 'EACCES');
}
