import { Result } from 'better-result';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

import type { ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { publishAtomic } from '@/lib/filesystem/atomic-write';
import type { FilesystemProblem } from '@/lib/filesystem/path';
import type { OperationProgress } from '@/modules/operations/contract';

import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { finished, pipeline } from 'node:stream/promises';

type ZipSourceFile = {
   archivePath: string;
   sourcePath: string;
};

type ZipExportRequest<Item> = {
   items: readonly Item[];
   destinationPath: string;
   maxBytes: number;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
   labelOf: (item: Item) => string;
   filesOf: (item: Item) => Promise<ZipSourceFile[]>;
};

export async function exportZip<Item extends { sizeBytes: number }>(
   request: ZipExportRequest<Item>
): Promise<Result<ZipExportSummary, ContentProblem>> {
   const files: ZipSourceFile[] = [];
   const totalBytes = request.items.reduce((total, item) => total + item.sizeBytes, 0);
   let bytes = 0;

   for (const item of request.items) {
      if (request.signal?.aborted) return Result.err(createProblem('content.export.cancelled'));

      const collected = await Result.tryPromise({
         try: async () => {
            const itemFiles = await request.filesOf(item);
            const sizes = await Promise.all(itemFiles.map(async (file) => (await stat(file.sourcePath)).size));
            return { itemFiles, size: sizes.reduce((total, size) => total + size, 0) };
         },
         catch: (cause): ContentProblem => createProblem('content.export.unreadable', { item: request.labelOf(item), cause })
      });
      if (Result.isError(collected)) return Result.err(collected.error);

      bytes += collected.value.size;
      if (bytes > request.maxBytes) return Result.err(createProblem('content.export.too-large'));

      files.push(...collected.value.itemFiles);
      request.onProgress?.({ phase: 'reading', label: request.labelOf(item), current: bytes, total: totalBytes, unit: 'bytes' });
   }

   if (files.length === 0) return Result.err(createProblem('content.export.empty'));

   request.onProgress?.({ phase: 'compressing', current: bytes, total: bytes, percent: 100, unit: 'bytes' });

   const written = await publishAtomic(request.destinationPath, (partialPath) => writeZip(partialPath, files, request.signal));
   if (Result.isError(written)) {
      return Result.err(
         request.signal?.aborted
            ? createProblem('content.export.cancelled')
            : createProblem('content.export.write-failed', { detail: written.error.detail })
      );
   }

   return Result.ok({ bytes, files: files.length });
}

type ZipExportSummary = { bytes: number; files: number };

async function writeZip(partialPath: string, files: readonly ZipSourceFile[], signal?: AbortSignal) {
   const output = createWriteStream(partialPath, { flags: 'w' });
   const streamed = await Result.tryPromise({
      try: () => pipeline(zipFiles(files, { compression: 'deflate', signal }), output),
      catch: (cause): FilesystemProblem => createProblem('filesystem.operation.write-failed', { path: partialPath, cause })
   });
   if (Result.isError(streamed)) {
      output.destroy();
      await Result.tryPromise(() => finished(output));
   }

   return streamed;
}

export async function* zipFiles(files: readonly ZipSourceFile[], options: { compression: 'store' | 'deflate'; signal?: AbortSignal }) {
   const ready: Uint8Array[] = [];
   let failure: Error | null = null;
   const archive = new Zip((error, data) => {
      if (error) failure = error;
      else if (data.byteLength > 0) ready.push(data);
   });
   function* flush() {
      if (failure) throw failure;
      yield* ready.splice(0);
   }

   for (const file of files) {
      const entry = options.compression === 'store' ? new ZipPassThrough(file.archivePath) : new ZipDeflate(file.archivePath, { level: 6 });
      archive.add(entry);

      for await (const chunk of createReadStream(file.sourcePath, { signal: options.signal })) {
         if (!(chunk instanceof Uint8Array)) throw new TypeError('Expected binary chunk');
         entry.push(chunk);
         yield* flush();
      }

      entry.push(new Uint8Array(), true);
      yield* flush();
   }

   archive.end();
   yield* flush();
}
