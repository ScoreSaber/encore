import { Result } from 'better-result';
import type { z } from 'zod';

import {
   createFilesystemProblem,
   createTempPath,
   normalizeFilesystemPath,
   resolveManagedPath,
   type FilesystemProblem
} from '@/main/filesystem/path-helpers';
import { createWriteAuditEntry, finishWriteAuditEntry, type WriteAuditSink } from '@/main/filesystem/write-audit';
import type { FilesystemWriteScope } from '@/shared/filesystem';
import type { OperationId } from '@/shared/operations';

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ReadJsonOptions<T> = {
   defaultValue?: T;
};

export type WriteJsonOptions = {
   root: string;
   space?: number;
   scope?: FilesystemWriteScope;
   operationId?: OperationId;
   audit?: WriteAuditSink;
};

export async function readJsonFile<T>(jsonPath: string, schema: z.ZodType<T>, options: ReadJsonOptions<T> = {}) {
   const normalizedPath = normalizeFilesystemPath(jsonPath);
   const readResult = await Result.tryPromise({
      try: () => readFile(normalizedPath, 'utf8'),
      catch: (cause) => createFilesystemProblem('filesystem.json.read-failed', 'failed to read JSON file', normalizedPath, cause)
   });

   if (Result.isError(readResult)) {
      if (readResult.error.detail === 'ENOENT' && options.defaultValue !== undefined) {
         return Result.ok<T, FilesystemProblem>(options.defaultValue);
      }

      return Result.err<T, FilesystemProblem>(readResult.error);
   }

   const jsonResult = Result.try({
      try: (): unknown => JSON.parse(readResult.value),
      catch: (cause) => createFilesystemProblem('filesystem.json.invalid', 'JSON file contains invalid syntax', normalizedPath, cause)
   });

   if (Result.isError(jsonResult)) return Result.err<T, FilesystemProblem>(jsonResult.error);

   const parsed = schema.safeParse(jsonResult.value);
   if (!parsed.success) {
      return Result.err<T, FilesystemProblem>({
         code: 'filesystem.json.invalid',
         message: 'JSON file did not match the expected schema',
         path: normalizedPath,
         detail: parsed.error.message
      });
   }

   return Result.ok<T, FilesystemProblem>(parsed.data);
}

export async function writeJsonFileAtomic<T>(jsonPath: string, value: unknown, schema: z.ZodType<T>, options: WriteJsonOptions) {
   const managedPath = await resolveManagedPath({
      root: options.root,
      path: jsonPath
   });
   if (Result.isError(managedPath)) return Result.err<T, FilesystemProblem>(managedPath.error);

   const normalizedPath = normalizeFilesystemPath(managedPath.value.path);
   const parsed = schema.safeParse(value);

   if (!parsed.success) {
      return Result.err<T, FilesystemProblem>({
         code: 'filesystem.json.invalid',
         message: 'JSON value did not match the expected schema',
         path: normalizedPath,
         detail: parsed.error.message
      });
   }

   const auditEntry = createWriteAuditEntry({
      action: 'json-write',
      scope: options.scope ?? 'settings',
      targetPath: normalizedPath,
      operationId: options.operationId
   });

   await writeAuditEntry(options.audit, auditEntry);

   const temporaryPath = createTempPath({
      parentPath: dirname(normalizedPath),
      prefix: 'json-write'
   });
   const serialized = `${JSON.stringify(parsed.data, null, options.space ?? 3)}\n`;
   const writeResult = await Result.tryPromise({
      try: async () => {
         await mkdir(dirname(normalizedPath), { recursive: true });
         await writeFile(temporaryPath, serialized, 'utf8');
         await rename(temporaryPath, normalizedPath);
         return parsed.data;
      },
      catch: (cause) => createFilesystemProblem('filesystem.json.write-failed', 'failed to write JSON file', normalizedPath, cause)
   });

   if (Result.isError(writeResult)) {
      await cleanupTemporaryPath(temporaryPath);
      await writeAuditEntry(
         options.audit,
         finishWriteAuditEntry(auditEntry, {
            status: 'failed',
            error: {
               code: writeResult.error.code,
               message: writeResult.error.message,
               details: writeResult.error.detail ?? null
            }
         })
      );
      return writeResult;
   }

   await writeAuditEntry(
      options.audit,
      finishWriteAuditEntry(auditEntry, {
         status: 'completed',
         bytes: Buffer.byteLength(serialized),
         files: 1
      })
   );

   return writeResult;
}

async function writeAuditEntry(audit: WriteAuditSink | undefined, entry: Parameters<WriteAuditSink>[0]) {
   if (!audit) return;

   await Result.tryPromise({
      try: async () => {
         await audit(entry);
      },
      catch: (cause: unknown) => createFilesystemProblem('filesystem.json.write-failed', 'failed to write JSON audit entry', entry.targetPath, cause)
   });
}

async function cleanupTemporaryPath(temporaryPath: string) {
   await Result.tryPromise({
      try: () => rm(temporaryPath, { recursive: true, force: true }),
      catch: (cause) => createFilesystemProblem('filesystem.json.write-failed', 'failed to clean up temporary JSON file', temporaryPath, cause)
   });
}
