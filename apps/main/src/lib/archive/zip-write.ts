import { Result } from 'better-result';
import { Zip, ZipDeflate } from 'fflate';
import { z } from 'zod';

import { createFilesystemProblem, type FilesystemProblem } from '@/lib/filesystem/path';

import { once } from 'node:events';
import { createReadStream, createWriteStream, type WriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';

export type ZipSourceFile = {
   archivePath: string;
   sourcePath: string;
};

export async function writeZipAtomic(destinationPath: string, files: readonly ZipSourceFile[], signal?: AbortSignal) {
   const partialPath = `${destinationPath}.part`;
   const output = createWriteStream(partialPath, { flags: 'w' });
   const written = await Result.tryPromise({
      try: async () => {
         await streamZip(output, files, signal);
         await renameCompleteArchive(partialPath, destinationPath);
      },
      catch: (cause): FilesystemProblem =>
         createFilesystemProblem('filesystem.operation.write-failed', 'failed to write zip archive', destinationPath, cause)
   });

   if (Result.isError(written)) {
      output.destroy();
      await Result.tryPromise({ try: () => finished(output), catch: () => null });
      await Result.tryPromise({
         try: () => rm(partialPath, { force: true }),
         catch: (cause): FilesystemProblem =>
            createFilesystemProblem('filesystem.operation.write-failed', 'failed to remove incomplete zip archive', partialPath, cause)
      });
   }

   return written;
}

async function streamZip(output: WriteStream, files: readonly ZipSourceFile[], signal?: AbortSignal) {
   let needsDrain = false;
   let zipError: Error | null = null;
   let outputError: Error | null = null;
   output.on('error', (error) => {
      outputError = error;
   });
   const flush = async () => {
      if (outputError) throw outputError;
      if (!needsDrain) return;

      await once(output, 'drain');
      needsDrain = false;
      if (outputError) throw outputError;
   };
   const archive = new Zip((error, data) => {
      if (error) {
         zipError = error;
         output.destroy(error);
         return;
      }

      if (data.byteLength > 0 && !output.write(data)) needsDrain = true;
   });

   for (const file of files) {
      if (signal?.aborted) throw signal.reason ?? new Error('zip export aborted');

      const entry = new ZipDeflate(file.archivePath, { level: 6 });
      archive.add(entry);

      for await (const chunk of createReadStream(file.sourcePath, { signal })) {
         entry.push(z.instanceof(Uint8Array).parse(chunk));
         await flush();
         if (zipError) throw zipError;
      }

      entry.push(new Uint8Array(), true);
      await flush();
      if (zipError) throw zipError;
   }

   archive.end();
   await flush();
   if (zipError) throw zipError;

   output.end();
   await finished(output);
}

async function renameCompleteArchive(partialPath: string, destinationPath: string) {
   await rename(partialPath, destinationPath);
}
