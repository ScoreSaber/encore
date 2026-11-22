import { Result } from 'better-result';

import type { TargetUploadFailure } from '@/lib/api';
import { hashFile } from '@/lib/content/content-hash';
import { causeMessage, createProblem } from '@/lib/errors';
import { readPathInfo, removeQuietly } from '@/lib/filesystem/path';
import { modsApi, type TargetModRequest } from '@/modules/mods/api';
import {
   invalidModAction,
   type ModImportPreview,
   type ModImportRequest,
   type ModImportUploadPrepared,
   type ModImportUploadRequest,
   type ModIssue,
   type ModOperationResult
} from '@/modules/mods/contract';
import { maxModArchiveBytes } from '@/modules/mods/main/mod-install';
import type { ModService } from '@/modules/mods/main/mod-service';
import type { TargetRequest } from '@/modules/targets/contract';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const uploadLifetimeMs = 10 * 60 * 1_000;
const defaultImportExtensions = new Set(['.dll', '.zip']);

type PendingUploadState = { status: 'pending' } | { status: 'receiving'; abort: AbortController } | { status: 'complete' };

type PendingUpload = {
   installId: string;
   fileName: string;
   path: string;
   sizeBytes: number;
   sha256: string;
   state: PendingUploadState;
   expiry: ReturnType<typeof setTimeout>;
};

type UploadProblem = { issue: ModIssue; detail?: string };

export function createModUploadService(options: {
   dataPath: string;
   mods: Pick<ModService, 'previewImport' | 'importMod'>;
   directoryName?: string;
   extensions?: ReadonlySet<string>;
   maxBytes?: number;
}) {
   const root = join(options.dataPath, options.directoryName ?? 'mod-uploads');
   const extensions = options.extensions ?? defaultImportExtensions;
   const maxBytes = options.maxBytes ?? maxModArchiveBytes;
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
      if (basename(request.fileName) !== request.fileName || !extensions.has(extension)) {
         return invalidModAction(request, 'unsupported-file', extension);
      }
      if (request.sizeBytes > maxBytes) return invalidModAction(request, 'unsupported-file', `${request.sizeBytes} bytes`);

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
         state: { status: 'pending' },
         expiry
      });

      return { status: 'ready', installId: request.installId, uploadId: id };
   }

   async function receive(
      request: { installId: string; uploadId: string },
      source: AsyncIterable<Uint8Array>
   ): Promise<Result<void, TargetUploadFailure>> {
      const upload = pending.get(request.uploadId);
      if (!upload || upload.installId !== request.installId || upload.state.status !== 'pending') {
         return Result.err({ kind: 'not-found', ...createProblem('mods.upload.not-found') });
      }
      const abort = new AbortController();
      upload.state = { status: 'receiving', abort };

      const initialised = await initialise;
      if (Result.isError(initialised)) {
         await discard(request.uploadId);
         return Result.err({ kind: 'unavailable', ...createProblem('mods.upload.unavailable', { detail: initialised.error.detail }) });
      }
      if (pending.get(request.uploadId) !== upload) {
         return Result.err({ kind: 'not-found', ...createProblem('mods.upload.not-found') });
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
         try: () => pipeline(source, inspect, createWriteStream(upload.path, { flags: 'wx' }), { signal: abort.signal }),
         catch: (cause): TargetUploadFailure => ({ kind: 'invalid', ...createProblem('mods.upload.failed', { cause }) })
      });
      if (Result.isError(received)) {
         await discard(request.uploadId);
         await removeQuietly(upload.path);
         return Result.err(received.error);
      }

      if (pending.get(request.uploadId) !== upload) {
         await removeQuietly(upload.path);
         return Result.err({ kind: 'not-found', ...createProblem('mods.upload.not-found') });
      }

      if (size !== upload.sizeBytes || digest.digest('hex') !== upload.sha256) {
         await discard(request.uploadId);
         return Result.err({ kind: 'invalid', ...createProblem('mods.upload.mismatch') });
      }

      upload.state = { status: 'complete' };
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

   async function importMod(request: { installId: string; uploadId: string }) {
      const upload = claim(request.uploadId, request.installId);
      if (Result.isError(upload)) return Result.err(createProblem('mods.upload.not-found', { detail: upload.error.detail }));

      return options.mods.importMod({ installId: request.installId, sourcePath: upload.value.path, sourceName: upload.value.fileName }, () =>
         rm(upload.value.path, { force: true })
      );
   }

   function completed(uploadId: string, installId: string) {
      const upload = pending.get(uploadId);
      return upload?.state.status === 'complete' && upload.installId === installId
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

   async function discard(uploadId: string, installId?: string) {
      const upload = pending.get(uploadId);
      if (!upload || (installId !== undefined && upload.installId !== installId)) return false;

      clearTimeout(upload.expiry);
      pending.delete(uploadId);
      if (upload.state.status === 'receiving') upload.state.abort.abort();
      await removeQuietly(upload.path);
      return true;
   }

   return {
      prepareImportUpload: prepare,
      previewImportUpload: preview,
      importUpload: importMod,
      discardImportUpload: async ({ installId, uploadId }: { installId?: string; uploadId: string }) => ({
         discarded: await discard(uploadId, installId)
      }),
      importFile: receive
   };
}

export type ModUploadService = ReturnType<typeof createModUploadService>;

export async function uploadModToTarget(
   targets: TargetRegistry,
   request: TargetModRequest,
   file: { path: string; fileName: string }
): Promise<ModImportPreview> {
   const info = await readPathInfo(file.path);
   if (Result.isError(info) || info.value.kind !== 'file' || info.value.isLink) return invalidModAction(request, 'inspect-failed', file.fileName);

   const digest = await hashFile(file.path, 'sha256');
   if (Result.isError(digest)) return invalidModAction(request, 'inspect-failed', digest.error.detail);

   const prepared = await targets.callTarget(modsApi, 'prepareImportUpload', request.targetId, {
      installId: request.installId,
      fileName: file.fileName,
      sizeBytes: info.value.sizeBytes,
      sha256: digest.value
   });
   if (prepared.status !== 'ok') {
      return invalidModAction(request, 'unsupported-target', prepared.status === 'unavailable' ? prepared.error.message : undefined);
   }
   if (prepared.value.status === 'invalid') return prepared.value;

   const upload = { installId: request.installId, uploadId: prepared.value.uploadId };
   const discard = () => targets.callTarget(modsApi, 'discardImportUpload', request.targetId, upload);
   const uploaded = await targets.uploadTarget(modsApi, 'importFile', request.targetId, upload, { path: file.path, sizeBytes: info.value.sizeBytes });
   if (uploaded.status !== 'ok') {
      await discard();
      return invalidModAction(request, 'inspect-failed', uploaded.status === 'unavailable' ? uploaded.error.message : undefined);
   }

   const preview = await targets.callTarget(modsApi, 'previewImportUpload', request.targetId, upload);
   if (preview.status !== 'ok') {
      await discard();
      return invalidModAction(request, 'inspect-failed', preview.status === 'unavailable' ? preview.error.message : undefined);
   }
   if (preview.value.status === 'invalid') await discard();

   return preview.value;
}

export async function importModUpload(targets: TargetRegistry, request: TargetRequest<ModImportRequest>): Promise<ModOperationResult> {
   if (!request.uploadId) return { ok: false, error: createProblem('mods.upload.required') };

   const imported = await targets.callTarget(modsApi, 'importUpload', request.targetId, { installId: request.installId, uploadId: request.uploadId });
   if (imported.status === 'ok') return imported.value;
   if (imported.status === 'unavailable') return { ok: false, error: imported.error };

   return { ok: false, error: createProblem('mods.unsupported-target') };
}
