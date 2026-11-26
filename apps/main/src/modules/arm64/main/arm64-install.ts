import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import { pathExistsSafely, removeQuietly } from '@/lib/filesystem/path';
import { isArm64Image } from '@/modules/installs/main/beat-saber-files';

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const stateDirectory = '.armonica';

const otherToolStateDirectory = '.bs-arm64';

const stateSchema = z.object({ id: z.string(), files: z.record(z.string(), z.string()) });

export type Placement = { target: string; source: string; replaces?: RegExp };

export function enterNative(installPath: string, id: string, placements: Placement[]): Promise<Result<void, Problem>> {
   return Result.tryPromise({
      try: async () => {
         const state = await readState(installPath);
         const wanted: (Placement & { ours: boolean })[] = [];
         for (const placement of placements) {
            const destination = join(installPath, placement.target);
            const ours = await isOurs(destination, state.files[placement.target]);
            if (ours || !placement.replaces || (await matches(destination, placement.replaces))) wanted.push({ ...placement, ours });
         }

         const stale = Object.keys(state.files).filter((target) => !wanted.some((placement) => placement.target === target));
         const pending = state.id === id ? wanted.filter((placement) => !placement.ours) : wanted;
         if (pending.length === 0 && stale.length === 0) return Result.ok();

         const files = { ...state.files };
         for (const { target, source } of pending) {
            const data = await readFile(source);
            files[target] = createHash('sha256').update(data).digest('hex');
         }
         const intended = await writeState(installPath, { id: '', files });
         if (Result.isError(intended)) return intended;

         for (const target of stale) {
            await restoreFile(installPath, target, state.files[target]);
            delete files[target];
         }
         for (const { target, source, ours } of pending) {
            const destination = join(installPath, target);
            const backup = backupPath(installPath, target);
            const displaces = !ours && (await pathExistsSafely(destination));
            const keepsBackup = (await pathExistsSafely(backup)) && (await isArm64Image(destination));
            if (displaces && !keepsBackup) await replaceFile(destination, backup);
            await replaceFile(source, destination);
         }
         return writeState(installPath, { id, files });
      },
      catch: (cause) => createProblem('arm64.install-failed', { cause })
   }).then(Result.flatten);
}

export function leaveNative(installPath: string): Promise<Result<void, Problem>> {
   return Result.tryPromise({
      try: async () => {
         const state = await readState(installPath);
         for (const [target, sha256] of Object.entries(state.files)) await restoreFile(installPath, target, sha256);

         const directory = join(installPath, stateDirectory);
         await removeQuietly(join(directory, 'x64'));
         await rm(join(directory, 'state.json'), { force: true });
         await Result.tryPromise(() => rmdir(directory));
      },
      catch: (cause) => createProblem('arm64.restore-failed', { cause })
   });
}

export function undoOtherToolConversion(installPath: string): Promise<Result<void, Problem>> {
   return Result.tryPromise({
      try: async () => {
         const directory = join(installPath, otherToolStateDirectory);
         const backups = await Result.tryPromise(() => readdir(join(directory, 'backup'), { recursive: true, withFileTypes: true }));
         if (Result.isError(backups)) return;

         for (const entry of backups.value.filter((candidate) => candidate.isFile())) {
            const backup = join(entry.parentPath, entry.name);
            const destination = join(installPath, relative(join(directory, 'backup'), backup));
            if (await pathExistsSafely(destination)) await rename(backup, destination);
         }

         const added = await Result.tryPromise(() => readFile(join(directory, 'added'), 'utf8'));
         for (const target of Result.isOk(added) ? added.value.split('\n').filter(Boolean) : []) {
            await rm(join(installPath, target), { force: true });
            if (dirname(target) !== '.') await Result.tryPromise(() => rmdir(join(installPath, dirname(target))));
         }
         await removeQuietly(directory);
      },
      catch: (cause) => createProblem('arm64.restore-failed', { cause })
   });
}

async function restoreFile(installPath: string, target: string, sha256: string | undefined) {
   const destination = join(installPath, target);
   const backup = backupPath(installPath, target);
   if (!(await isOurs(destination, sha256))) return rm(backup, { force: true });
   if (await pathExistsSafely(backup)) return rename(backup, destination);

   await rm(destination);
   if (dirname(target) !== '.') await Result.tryPromise(() => rmdir(dirname(destination)));
}

async function isOurs(destination: string, sha256: string | undefined) {
   if (!sha256) return false;
   if (await isArm64Image(destination)) return true;

   const current = await Result.tryPromise(() => readFile(destination));
   return Result.isOk(current) && createHash('sha256').update(current.value).digest('hex') === sha256;
}

async function matches(path: string, pattern: RegExp) {
   const content = await Result.tryPromise(() => readFile(path, 'latin1'));
   return Result.isOk(content) && pattern.test(content.value);
}

async function replaceFile(source: string, destination: string) {
   await mkdir(dirname(destination), { recursive: true });
   await copyFile(source, `${destination}.partial`);
   await rename(`${destination}.partial`, destination);
}

function backupPath(installPath: string, target: string) {
   return join(installPath, stateDirectory, 'x64', target);
}

function readState(installPath: string) {
   return readJsonFileOrDefault(join(installPath, stateDirectory, 'state.json'), stateSchema, { defaultValue: { id: '', files: {} } });
}

async function writeState(installPath: string, state: z.infer<typeof stateSchema>): Promise<Result<void, Problem>> {
   const written = await writeJsonFileAtomic(join(installPath, stateDirectory, 'state.json'), state, stateSchema, { root: installPath });
   return written.map(() => undefined);
}
