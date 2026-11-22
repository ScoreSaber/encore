import { Result } from 'better-result';

import { causeCode, createProblem } from '@/lib/errors';
import { removeQuietly, type FilesystemProblem } from '@/lib/filesystem/path';

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function publishAtomic<Value, Failure>(
   destinationPath: string,
   write: (partialPath: string) => Promise<Result<Value, Failure>>,
   options?: { dirMode?: number }
) {
   const partialPath = `${destinationPath}.${randomUUID()}.part`;
   const published = await Result.tryPromise({
      try: async () => {
         await mkdir(dirname(destinationPath), options?.dirMode === undefined ? { recursive: true } : { recursive: true, mode: options.dirMode });
         const written = await write(partialPath);
         if (Result.isOk(written)) await rename(partialPath, destinationPath);
         return written;
      },
      catch: (cause): FilesystemProblem => createProblem('filesystem.operation.write-failed', { path: destinationPath, cause })
   }).then(Result.flatten);

   if (Result.isError(published)) await removeQuietly(partialPath);

   return published;
}

export function writeFileAtomic(destinationPath: string, contents: string | Uint8Array, options?: { dirMode?: number; fileMode?: number }) {
   return publishAtomic(
      destinationPath,
      async (partialPath) => {
         await writeFile(partialPath, contents, options?.fileMode === undefined ? undefined : { mode: options.fileMode });
         return Result.ok<void, FilesystemProblem>(undefined);
      },
      options
   );
}

export async function publishFileExclusive(sourcePath: string, destinationPath: string) {
   const linked = await Result.tryPromise({
      try: () => link(sourcePath, destinationPath),
      catch: (cause) => cause
   });
   if (Result.isOk(linked)) return;
   if (causeCode(linked.error) === 'EEXIST') throw linked.error;
   await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
}
