import { Result } from 'better-result';

import { causeMessage, createProblem, type Problem } from '@/lib/errors';
import { assertCanCopyToDestination, readPathInfo } from '@/lib/filesystem/path';

import { constants } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type PrefixProblem = Problem<
   | 'bsmanager.prefix-copy-failed'
   | 'bsmanager.prefix-copied-cleanup-failed'
   | 'bsmanager.prefix-replace-confirmation-required'
   | 'bsmanager.prefix-copy-unavailable'
>;
const copyOptions = { mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true };

async function inspectDestination(destination: string): Promise<Result<{ exists: boolean; populated: boolean }, PrefixProblem>> {
   const info = await readPathInfo(destination);
   if (Result.isError(info)) {
      if (info.error.detail === 'ENOENT') return Result.ok({ exists: false, populated: false });
      return Result.err(createProblem('bsmanager.prefix-copy-failed', { detail: info.error.message }));
   }
   // Never replace a link, even if it points to a directory (or is dangling).
   if (info.value.kind !== 'directory') {
      return Result.err(createProblem('bsmanager.prefix-copy-failed', { detail: 'Encore compatibility data must be a directory' }));
   }
   return Result.tryPromise({
      try: async () => ({ exists: true, populated: (await readdir(destination)).length > 0 }),
      catch: (cause) => createProblem('bsmanager.prefix-copy-failed', { cause })
   });
}

export async function inspectBSManagerPrefix(sharedContentPath: string, dataPath: string) {
   const prefixPath = join(sharedContentPath, 'compatdata', 'pfx');
   const info = await readPathInfo(prefixPath);
   if (Result.isError(info) || info.value.kind !== 'directory') return { prefixPath: null, existingPrefix: false };
   const destination = await inspectDestination(join(dataPath, 'compatdata'));
   return Result.isError(destination) ? { prefixPath: null, existingPrefix: false } : { prefixPath, existingPrefix: destination.value.populated };
}

export async function copyBSManagerPrefix(prefixPath: string, dataPath: string, replacePrefix: boolean): Promise<Result<void, PrefixProblem>> {
   const source = await readPathInfo(prefixPath);
   if (Result.isError(source) || source.value.kind !== 'directory') return Result.err(createProblem('bsmanager.prefix-copy-unavailable'));

   return Result.tryPromise({
      try: async () => {
         await mkdir(dataPath, { recursive: true });
         // Resolve the parent too: the destination may not exist yet, and dataPath may be a link.
         const destination = join(await realpath(dataPath), 'compatdata');
         const safe = await assertCanCopyToDestination(dirname(prefixPath), destination);
         if (Result.isError(safe))
            return Result.err<void, PrefixProblem>(createProblem('bsmanager.prefix-copy-failed', { detail: safe.error.message }));
         const staged = await mkdtemp(join(dataPath, '.bsmanager-compatdata-'));
         const incoming = join(staged, 'incoming');
         const previous = join(staged, 'previous');
         let preservePrevious = false;
         const copied = await Result.tryPromise({
            try: async (): Promise<Result<void, PrefixProblem>> => {
               await mkdir(incoming);
               await cp(prefixPath, join(incoming, 'pfx'), { ...copyOptions, recursive: true });
               // Proton uses these files when upgrading an existing prefix.
               for (const name of ['version', 'tracked_files', 'config_info', 'proton-fex-config.json']) {
                  const path = join(dirname(prefixPath), name);
                  const info = await readPathInfo(path);
                  if (Result.isError(info)) {
                     if (info.error.detail === 'ENOENT') continue;
                     return Result.err(createProblem('bsmanager.prefix-copy-failed', { detail: info.error.message }));
                  }
                  if (info.value.kind === 'file') await cp(path, join(incoming, name), copyOptions);
               }
               // Recheck after staging so newly created data also requires explicit consent.
               const current = await inspectDestination(destination);
               if (Result.isError(current)) return current.map(() => undefined);
               if (current.value.populated && !replacePrefix) return Result.err(createProblem('bsmanager.prefix-replace-confirmation-required'));
               if (current.value.exists) {
                  await rename(destination, previous);
                  preservePrevious = true;
               }
               try {
                  await rename(incoming, destination);
               } catch (cause) {
                  if (preservePrevious) {
                     try {
                        await rename(previous, destination);
                        preservePrevious = false;
                     } catch (rollbackCause) {
                        return Result.err(
                           createProblem('bsmanager.prefix-copy-failed', {
                              detail: `${causeMessage(cause)}. Restore failed: ${causeMessage(rollbackCause)}. The original Proton prefix is still at ${previous}`
                           })
                        );
                     }
                  }
                  return Result.err(createProblem('bsmanager.prefix-copy-failed', { cause }));
               }
               preservePrevious = false;
               return Result.ok();
            },
            catch: (cause) => createProblem('bsmanager.prefix-copy-failed', { cause })
         });
         const outcome = copied.andThen((result) => result);
         // A failed rollback must retain the backup and its path in the original error.
         const cleaned = await Result.tryPromise({
            try: () => rm(preservePrevious ? incoming : staged, { recursive: true, force: true }),
            catch: (cause) =>
               createProblem('bsmanager.prefix-copied-cleanup-failed', {
                  detail: `Staging cleanup failed at ${staged}: ${causeMessage(cause)}`
               })
         });
         return Result.isError(outcome) ? outcome : cleaned;
      },
      catch: (cause) => createProblem('bsmanager.prefix-copy-failed', { cause })
   }).then((result) => result.andThen((outcome) => outcome));
}
