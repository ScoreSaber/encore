import { Result } from 'better-result';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { copyBSManagerPrefix } from './prefix';

import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:fs/promises', async (original) => {
   const actual = await original<typeof fs>();
   return { ...actual, cp: vi.fn(actual.cp), rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const roots: string[] = [];
afterEach(async () => {
   vi.restoreAllMocks();
   vi.mocked(fs.cp).mockReset();
   vi.mocked(fs.rename).mockReset();
   vi.mocked(fs.rm).mockReset();
   const actual = await vi.importActual<typeof fs>('node:fs/promises');
   vi.mocked(fs.cp).mockImplementation(actual.cp);
   vi.mocked(fs.rename).mockImplementation(actual.rename);
   vi.mocked(fs.rm).mockImplementation(actual.rm);
   await Promise.all(roots.splice(0).map((root) => actual.rm(root, { recursive: true, force: true })));
});

async function setup(existing = true) {
   const root = await fs.mkdtemp(join(tmpdir(), 'encore-prefix-test-'));
   roots.push(root);
   const prefix = join(root, 'source', 'pfx');
   const data = join(root, 'data');
   const destination = join(data, 'compatdata');
   await fs.mkdir(prefix, { recursive: true });
   await fs.mkdir(data);
   await fs.writeFile(join(prefix, 'system.reg'), 'new');
   if (existing) {
      await fs.mkdir(destination);
      await fs.writeFile(join(destination, 'old'), 'original');
   }
   return { root, prefix, data, destination };
}

async function expectClean(data: string) {
   expect((await fs.readdir(data)).filter((name) => name.startsWith('.bsmanager-'))).toEqual([]);
}

test('requires replacement consent and cleans staging without touching the old prefix', async () => {
   const { prefix, data, destination } = await setup();
   expect(await copyBSManagerPrefix(prefix, data, false)).toMatchObject({
      status: 'error',
      error: { code: 'bsmanager.prefix-replace-confirmation-required' }
   });
   expect(await fs.readFile(join(destination, 'old'), 'utf8')).toBe('original');
   await expectClean(data);
});

test('rolls back a failed commit and removes staging', async () => {
   const { prefix, data, destination } = await setup();
   const actual = await vi.importActual<typeof fs>('node:fs/promises');
   vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('/incoming')) throw new Error('commit failed');
      return actual.rename(from, to);
   });
   expect(await copyBSManagerPrefix(prefix, data, true)).toMatchObject({ status: 'error', error: { detail: 'commit failed' } });
   expect(await fs.readFile(join(destination, 'old'), 'utf8')).toBe('original');
   await expectClean(data);
});

test('preserves the backup path when rollback fails even if cleanup also fails', async () => {
   const { prefix, data } = await setup();
   const actual = await vi.importActual<typeof fs>('node:fs/promises');
   vi.mocked(fs.rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('/incoming') || String(from).endsWith('/previous')) throw new Error('rename failed');
      return actual.rename(from, to);
   });
   vi.mocked(fs.rm).mockRejectedValue(new Error('cleanup failed'));
   const result = await copyBSManagerPrefix(prefix, data, true);
   expect(Result.isError(result)).toBe(true);
   const staged = (await fs.readdir(data)).find((name) => name.startsWith('.bsmanager-'));
   const backup = join(data, staged ?? '', 'previous');
   expect(result).toMatchObject({ error: { detail: expect.stringContaining(backup) } });
   expect(await fs.readFile(join(backup, 'old'), 'utf8')).toBe('original');
});

test('copy failure leaves existing data intact and cleans partial staging', async () => {
   const { prefix, data, destination } = await setup();
   vi.mocked(fs.cp).mockRejectedValueOnce(new Error('disk full'));
   expect(await copyBSManagerPrefix(prefix, data, true)).toMatchObject({ status: 'error', error: { detail: 'disk full' } });
   expect(await fs.readFile(join(destination, 'old'), 'utf8')).toBe('original');
   await expectClean(data);
});

test('rechecks replacement consent after staging when a destination appears', async () => {
   const { prefix, data, destination } = await setup(false);
   const actual = await vi.importActual<typeof fs>('node:fs/promises');
   vi.mocked(fs.cp).mockImplementationOnce(async (from, to, options) => {
      await actual.cp(from, to, options);
      await fs.mkdir(destination);
      await fs.writeFile(join(destination, 'old'), 'created during staging');
   });
   expect(await copyBSManagerPrefix(prefix, data, false)).toMatchObject({ error: { code: 'bsmanager.prefix-replace-confirmation-required' } });
   expect(await fs.readFile(join(destination, 'old'), 'utf8')).toBe('created during staging');
   await expectClean(data);
});

test('rejects a destination symlink and a missing destination physically inside the source', async () => {
   const { root, prefix, data, destination } = await setup(false);
   await fs.symlink(join(root, 'source'), destination);
   expect(Result.isError(await copyBSManagerPrefix(prefix, data, true))).toBe(true);
   expect(await fs.readFile(join(prefix, 'system.reg'), 'utf8')).toBe('new');
   await fs.symlink(prefix, join(root, 'linked-data'));
   expect(Result.isError(await copyBSManagerPrefix(prefix, join(root, 'linked-data'), true))).toBe(true);
   expect(await fs.readdir(prefix)).toEqual(['system.reg']);
   await expectClean(data);
});

test('reports a cleanup failure with its staging path after a successful commit', async () => {
   const { prefix, data, destination } = await setup();
   vi.mocked(fs.rm).mockRejectedValueOnce(new Error('cleanup denied'));
   expect(await copyBSManagerPrefix(prefix, data, true)).toMatchObject({
      status: 'error',
      error: { code: 'bsmanager.prefix-copied-cleanup-failed', detail: expect.stringContaining('Staging cleanup failed at') }
   });
   expect(await fs.readFile(join(destination, 'pfx', 'system.reg'), 'utf8')).toBe('new');
   const staged = (await fs.readdir(data)).find((name) => name.startsWith('.bsmanager-'));
   expect(await fs.readFile(join(data, staged ?? '', 'previous', 'old'), 'utf8')).toBe('original');
});
