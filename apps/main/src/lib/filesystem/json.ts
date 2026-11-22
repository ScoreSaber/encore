import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem } from '@/lib/errors';
import { writeFileAtomic } from '@/lib/filesystem/atomic-write';
import { resolveFilesystemPath, resolveManagedPath, type FilesystemProblem } from '@/lib/filesystem/path';

import { readFile } from 'node:fs/promises';

type ReadJsonOptions<T> = {
   defaultValue?: T;
};

export async function readJsonFile<T>(jsonPath: string, schema: z.ZodType<T>, options: ReadJsonOptions<T> = {}) {
   const normalizedPath = resolveFilesystemPath(jsonPath);
   const readResult = await Result.tryPromise({
      try: () => readFile(normalizedPath, 'utf8'),
      catch: (cause) => createProblem('filesystem.json.read-failed', { path: normalizedPath, cause })
   });

   if (Result.isError(readResult)) {
      if (readResult.error.detail === 'ENOENT' && options.defaultValue !== undefined) {
         return Result.ok<T, FilesystemProblem>(options.defaultValue);
      }

      return Result.err<T, FilesystemProblem>(readResult.error);
   }

   const jsonResult = Result.try({
      try: () => z.json().parse(JSON.parse(readResult.value)),
      catch: (cause) => createProblem('filesystem.json.invalid', { path: normalizedPath, cause })
   });

   if (Result.isError(jsonResult)) return Result.err<T, FilesystemProblem>(jsonResult.error);

   const parsed = schema.safeParse(jsonResult.value);
   if (!parsed.success) {
      return Result.err<T, FilesystemProblem>(createProblem('filesystem.json.invalid', { path: normalizedPath, detail: parsed.error.message }));
   }

   return Result.ok<T, FilesystemProblem>(parsed.data);
}

export async function readJsonFileOrDefault<T>(jsonPath: string, schema: z.ZodType<T>, options: { defaultValue: T }) {
   const read = await readJsonFile(jsonPath, schema);
   return Result.isOk(read) ? read.value : options.defaultValue;
}

export async function writeJsonFileAtomic<T>(jsonPath: string, value: T, schema: z.ZodType<T>, options: { root: string }) {
   const managedPath = await resolveManagedPath({
      root: options.root,
      path: jsonPath
   });
   if (Result.isError(managedPath)) return Result.err<T, FilesystemProblem>(managedPath.error);

   const { path } = managedPath.value;
   const parsed = schema.safeParse(value);

   if (!parsed.success) {
      return Result.err<T, FilesystemProblem>(createProblem('filesystem.json.invalid', { path, detail: parsed.error.message }));
   }

   const serialized = `${JSON.stringify(parsed.data, null, 3)}\n`;
   const written = await writeFileAtomic(path, serialized);
   return Result.isOk(written)
      ? Result.ok<T, FilesystemProblem>(parsed.data)
      : Result.err<T, FilesystemProblem>({ ...written.error, ...createProblem('filesystem.json.write-failed') });
}
