import { Result } from 'better-result';

import type { TargetUploadFailure } from '@/lib/api';
import { causeMessage } from '@/lib/errors';
import type { ModImportPreview, ModImportUploadPrepared, ModImportUploadRequest, ModIssue, ModOperationResult } from '@/modules/mods/contract';
import { invalidModAction } from '@/modules/mods/contract';
import { maxModArchiveBytes } from '@/modules/mods/main/mod-install';
import type { ModService } from '@/modules/mods/main/mod-service';

import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const uploadLifetimeMs = 10 * 60 * 1_000;
const importExtensions = new Set(['.dll', '.zip']);

type PendingUpload = {
   installId: string;
   fileName: string;
   path: string;
   sizeBytes: number;
   sha256: string;
   status: 'pending' | 'receiving' | 'complete';
   expiry: ReturnType<typeof setTimeout>;
};

type UploadProblem = { issue: ModIssue; detail?: string };

export function createModUploadService(options: { dataPath: string; mods: ModService }) {
   const root = join(options.dataPath, 'mod-uploads');
   const pending = new Map<string, PendingUpload>();
   const initialise = Result.tryPromise({
      try: async () => {
         await rm(root, { recursive: true, force: true });
         await mkdir(root, { recursive: true });
      },
      catch: (cause): UploadProblem => ({ issue: 'inspect-failed', detail: causeMessage(cause) })
   });

   async function prepare(request: ModImportUploadRequest): Promise<ModImportUploadPrepared> {
      const initialised = await initialise;
      if (Result.isError(initialised)) return invalidModAction(request, initialised.error.issue, initialised.error.detail);

      const extension = extname(request.fileName).toLowerCase();
      if (basename(request.fileName) !== request.fileName || !importExtensions.has(extension)) {
         return invalidModAction(request, 'unsupported-file', extension);
      }
      if (request.sizeBytes > maxModArchiveBytes) return invalidModAction(request, 'unsupported-file', 'the file is larger than Encore imports');

      const id = randomBytes(24).toString('hex');
      const path = join(root, `${id}${extension}`);
      const expiry = setTimeout(() => void discard(id), uploadLifetimeMs);
      expiry.unref();
      pending.set(id, {
         installId: request.installId,
         fileName: request.fileName,
         path,
         sizeBytes: request.sizeBytes,
         sha256: request.sha256.toLowerCase(),
         status: 'pending',
         expiry
      });

      return { status: 'ready', installId: request.installId, uploadId: id };
   }

   async function receive(
      request: { installId: string; uploadId: string },
      source: AsyncIterable<Uint8Array>
   ): Promise<Result<void, TargetUploadFailure>> {
      const upload = pending.get(request.uploadId);
      if (!upload || upload.installId !== request.installId || upload.status !== 'pending') {
         return Result.err({ kind: 'not-found', code: 'mods.upload.not-found', message: 'Mod upload was not found' });
      }
      upload.status = 'receiving';

      const initialised = await initialise;
      if (Result.isError(initialised)) {
         return Result.err({
            kind: 'unavailable',
            code: 'mods.upload.unavailable',
            message: initialised.error.detail ?? 'Mod uploads are unavailable'
         });
      }
      let size = 0;
      const digest = createHash('sha256');
      const inspect = new Transform({
         transform(chunk: Buffer, _encoding, callback) {
            size += chunk.byteLength;
            if (size > upload.sizeBytes) {
               callback(new Error('upload is larger than declared'));
               return;
            }

            digest.update(chunk);
            callback(null, chunk);
         }
      });
      const received = await Result.tryPromise({
         try: () => pipeline(source, inspect, createWriteStream(upload.path, { flags: 'wx' })),
         catch: (cause): TargetUploadFailure => ({ kind: 'invalid', code: 'mods.upload.failed', message: causeMessage(cause) })
      });
      if (Result.isError(received)) {
         await discard(request.uploadId);
         return Result.err(received.error);
      }

      if (size !== upload.sizeBytes || digest.digest('hex') !== upload.sha256) {
         await discard(request.uploadId);
         return Result.err({ kind: 'invalid', code: 'mods.upload.mismatch', message: 'Mod upload did not match the selected file' });
      }

      upload.status = 'complete';
      return Result.ok(undefined);
   }

   async function preview(request: { installId: string; uploadId: string }): Promise<ModImportPreview> {
      const upload = completed(request.uploadId, request.installId);
      if (Result.isError(upload)) return invalidModAction(request, upload.error.issue, upload.error.detail);

      const previewed = await options.mods.previewImport({
         installId: request.installId,
         sourcePath: upload.value.path,
         sourceName: upload.value.fileName
      });
      return previewed.status === 'ok' ? { ...previewed, sourcePath: upload.value.fileName, uploadId: request.uploadId } : previewed;
   }

   async function importMod(request: { installId: string; uploadId: string }): Promise<ModOperationResult> {
      const upload = claim(request.uploadId, request.installId);
      if (Result.isError(upload)) {
         return { ok: false, error: { code: `mods.${upload.error.issue}`, message: upload.error.detail ?? 'Mod upload is unavailable' } };
      }

      return options.mods.importMod({ installId: request.installId, sourcePath: upload.value.path, sourceName: upload.value.fileName }, () =>
         rm(upload.value.path, { force: true })
      );
   }

   function completed(uploadId: string, installId: string) {
      const upload = pending.get(uploadId);
      return upload?.status === 'complete' && upload.installId === installId
         ? Result.ok<PendingUpload, UploadProblem>(upload)
         : Result.err<PendingUpload, UploadProblem>({ issue: 'not-found', detail: uploadId });
   }

   function claim(uploadId: string, installId: string) {
      const upload = completed(uploadId, installId);
      if (Result.isError(upload)) return upload;

      clearTimeout(upload.value.expiry);
      pending.delete(uploadId);
      return upload;
   }

   async function discard(uploadId: string) {
      const upload = pending.get(uploadId);
      if (!upload) return false;

      clearTimeout(upload.expiry);
      pending.delete(uploadId);
      await rm(upload.path, { force: true });
      return true;
   }

   return { prepare, receive, preview, importMod, discard };
}

export type ModUploadService = ReturnType<typeof createModUploadService>;
