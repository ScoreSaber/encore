import { Result } from 'better-result';

import { assertCanCopyToDestination, readPathInfo } from '@/lib/filesystem/path';

import { constants } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const copyOptions = { mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true };

async function hasCompatibilityData(destination: string) {
   const info = await readPathInfo(destination);
   if (Result.isError(info)) {
      if (info.error.detail === 'ENOENT') return false;
      throw new Error(info.error.message);
   }
   if (info.value.kind !== 'directory') throw new Error('Encore compatibility data must be a directory');
   return (await readdir(destination)).length > 0;
}

export async function inspectBSManagerPrefix(sharedContentPath: string, dataPath: string) {
   const prefixPath = join(sharedContentPath, 'compatdata', 'pfx');
   const info = await readPathInfo(prefixPath);
   if (Result.isError(info) || info.value.kind !== 'directory') return { prefixPath: null, existingPrefix: false };
   const existingPrefix = await hasCompatibilityData(join(dataPath, 'compatdata')).catch(() => null);
   return { prefixPath: existingPrefix === null ? null : prefixPath, existingPrefix: existingPrefix === true };
}

export async function copyBSManagerPrefix(prefixPath: string, dataPath: string, replacePrefix: boolean) {
   const destination = join(dataPath, 'compatdata');
   const safe = await assertCanCopyToDestination(dirname(prefixPath), destination);
   if (Result.isError(safe)) throw new Error(safe.error.message);

   await mkdir(dataPath, { recursive: true });
   const staged = await mkdtemp(join(dataPath, '.bsmanager-compatdata-'));
   const incoming = join(staged, 'incoming');
   const previous = join(staged, 'previous');
   let preservePrevious = false;
   try {
      await mkdir(incoming);
      await cp(prefixPath, join(incoming, 'pfx'), { ...copyOptions, recursive: true });
      // Proton uses these files to update an existing prefix when its runtime or configuration changes.
      for (const name of ['version', 'tracked_files', 'config_info', 'proton-fex-config.json']) {
         const source = join(dirname(prefixPath), name);
         const info = await readPathInfo(source);
         if (Result.isError(info)) {
            if (info.error.detail === 'ENOENT') continue;
            throw new Error(info.error.message);
         }
         if (info.value.kind === 'file') await cp(source, join(incoming, name), copyOptions);
      }
      if (replacePrefix && (await hasCompatibilityData(destination))) {
         await rename(destination, previous);
         preservePrevious = true;
      }

      try {
         await rename(incoming, destination);
         preservePrevious = false;
      } catch (cause) {
         if (preservePrevious) {
            await rename(previous, destination).catch(() => {
               throw new Error(`The original Proton prefix is still at ${previous}`, { cause });
            });
            preservePrevious = false;
         }
         throw cause;
      }
   } finally {
      await rm(preservePrevious ? incoming : staged, { recursive: true, force: true });
   }
}
