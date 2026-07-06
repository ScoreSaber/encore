import { Result } from 'better-result';

import { createDefaultInstallRoot } from '@/main/filesystem/install-root';
import {
   assertCanCopyToDestination,
   createTempPath,
   isPathInside,
   pathExists,
   readPathInfo,
   resolveManagedPath
} from '@/main/filesystem/path-helpers';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('filesystem path helpers', () => {
   test('keeps managed writes inside their expected root', async () => {
      const root = await createTempRoot();
      const allowed = await resolveManagedPath({ root, path: 'versions/1.29.1' });
      const blocked = await resolveManagedPath({ root, path: join(root, '..', 'outside') });

      expect(Result.isOk(allowed)).toBe(true);
      expect(Result.isError(blocked)).toBe(true);

      if (Result.isOk(allowed)) {
         expect(allowed.value.root).toBe(root);
         expect(allowed.value.relativePath).toBe(join('versions', '1.29.1'));
      }
   });

   test('rejects root targets unless the caller opts in', async () => {
      const root = await createTempRoot();
      const blocked = await resolveManagedPath({ root, path: root });
      const allowed = await resolveManagedPath({ root, path: root, allowRoot: true });

      expect(Result.isError(blocked)).toBe(true);
      expect(Result.isOk(allowed)).toBe(true);
   });

   test('rejects copying a directory into itself', async () => {
      const root = await createTempRoot();
      const source = join(root, 'source');
      const destination = join(source, 'nested-copy');

      expect(Result.isError(await assertCanCopyToDestination(source, source))).toBe(true);
      expect(Result.isError(await assertCanCopyToDestination(source, destination))).toBe(true);
      expect(Result.isError(await assertCanCopyToDestination(destination, source))).toBe(true);
      expect(Result.isOk(await assertCanCopyToDestination(source, join(root, 'destination')))).toBe(true);
   });

   test('creates temp paths under the requested parent', async () => {
      const root = await createTempRoot();
      const tempPath = createTempPath({ parentPath: root, prefix: 'copy' });

      expect(isPathInside(root, tempPath)).toBe(true);
   });

   test('detects filesystem links when the platform allows creating them', async () => {
      const root = await createTempRoot();
      const target = join(root, 'target');
      const linkPath = join(root, 'target-link');

      await mkdir(target);
      if (!(await createTestSymlink(target, linkPath, 'dir'))) return;

      const info = await readPathInfo(linkPath);

      expect(Result.isOk(info)).toBe(true);
      if (Result.isOk(info)) {
         expect(info.value.kind).toBe('link');
         expect(info.value.isLink).toBe(true);
         expect(info.value.targetPath).toBe(target);
      }
   });

   test('keeps managed writes from escaping through symlinked parent directories', async () => {
      const root = await createTempRoot();
      const outside = await createTempRoot();
      const escape = join(root, 'escape');

      if (!(await createTestSymlink(outside, escape, 'dir'))) return;

      const escaped = await resolveManagedPath({ root, path: join('escape', 'precious.txt') });
      const linkItself = await resolveManagedPath({ root, path: escape });

      expect(Result.isError(escaped)).toBe(true);
      expect(Result.isOk(linkItself)).toBe(true);
   });

   test('treats dangling symlinks as existing filesystem entries', async () => {
      const root = await createTempRoot();
      const linkPath = join(root, 'dangling-link');

      if (!(await createTestSymlink(join(root, 'missing-target'), linkPath))) return;

      const exists = await pathExists(linkPath);
      const info = await readPathInfo(linkPath);

      expect(Result.isOk(exists)).toBe(true);
      if (Result.isOk(exists)) expect(exists.value).toBe(true);
      expect(Result.isOk(info)).toBe(true);
      if (Result.isOk(info)) expect(info.value.kind).toBe('link');
   });

   test('reports missing paths as existence checks instead of throwing', async () => {
      const root = await createTempRoot();
      const exists = await pathExists(join(root, 'missing'));

      expect(Result.isOk(exists)).toBe(true);
      if (Result.isOk(exists)) expect(exists.value).toBe(false);
   });
});

describe('install root helpers', () => {
   test('uses app user data as the managed library parent', () => {
      expect(createDefaultInstallRoot({ platform: 'win32', userDataPath: 'C:\\Users\\Umbra\\AppData\\Roaming\\Encore' })).toContain('library');
      expect(createDefaultInstallRoot({ platform: 'linux', userDataPath: '/home/umbra/.config/encore' })).toBe('/home/umbra/.config/encore/library');
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
