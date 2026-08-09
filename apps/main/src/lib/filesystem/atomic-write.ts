import { Result } from 'better-result';

import { createFilesystemProblem, type FilesystemProblem } from '@/lib/filesystem/path';

import { rename, rm, writeFile } from 'node:fs/promises';

export async function writeFileAtomic(destinationPath: string, contents: Uint8Array) {
   // only rename a complete sibling file into place; clean up a failed partial write
   const partialPath = `${destinationPath}.part`;
   const written = await Result.tryPromise({
      try: async () => {
         await writeFile(partialPath, contents);
         await rename(partialPath, destinationPath);
      },
      catch: (cause): FilesystemProblem =>
         createFilesystemProblem('filesystem.operation.write-failed', 'failed to write file', destinationPath, cause)
   });

   if (Result.isError(written)) {
      await Result.tryPromise({
         try: () => rm(partialPath, { force: true }),
         catch: (cause): FilesystemProblem =>
            createFilesystemProblem('filesystem.operation.write-failed', 'failed to remove incomplete file', partialPath, cause)
      });
   }

   return written;
}
