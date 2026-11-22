import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { isPathInside, resolveManagedPath } from '@/lib/filesystem/path';
import { translate } from '@/lib/messages';
import { type DownloadIssue, type DownloadVersion, type OculusDownloadPreview } from '@/modules/downloads/contract';
import type { MetaAuthRequest } from '@/modules/downloads/main/meta-auth';
import { fetchMetaPayload, type MetaFetch, type MetaRequest } from '@/modules/downloads/main/meta-fetch';
import {
   maxManifestEntryBytes,
   maxSegmentBytes,
   metaManifestUrl,
   metaSegmentUrl,
   parseOculusManifest,
   type OculusManifestFile
} from '@/modules/downloads/main/oculus-manifest';
import { writeSegment } from '@/modules/downloads/main/oculus-segment';
import type { OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

import { createHash } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type OculusDownloaderOptions = {
   operations: OperationRegistry;
   requestToken: MetaAuthRequest;
   platform?: NodeJS.Platform;
   fetchBinary?: MetaFetch;
   concurrency?: number;
   maxAttempts?: number;
};

type DownloadState = {
   binaryId: string;
   token: string;
   destinationPath: string;
   operationId: OperationId;
   request: Omit<MetaRequest, 'failure'>;
   totalBytes: number;
   bytes: number;
   files: number;
   totalFiles: number;
   lastReportAt: number;
};

export type OculusDownloader = ReturnType<typeof createOculusDownloader>;

export function createOculusDownloader(options: OculusDownloaderOptions) {
   const platform = options.platform ?? process.platform;
   const fetchBinary = options.fetchBinary ?? ((url, init) => fetch(url, init));
   const concurrency = options.concurrency ?? 2;
   const maxAttempts = options.maxAttempts ?? 3;

   async function preview(
      entry: DownloadVersion,
      destination: Pick<OculusDownloadPreview, 'name' | 'installRoot' | 'destinationPath' | 'warnings'>
   ): Promise<Result<OculusDownloadPreview, { issue: DownloadIssue }>> {
      if (platform !== 'win32') return Result.err({ issue: 'unsupported-platform' });
      if (!entry.oculusBinaryId) return Result.err({ issue: 'binary-unavailable' });

      return Result.ok({
         status: 'ok',
         store: 'oculus',
         version: entry.version,
         binaryId: entry.oculusBinaryId,
         ...destination,
         warnings: ['meta-sign-in-opens', ...destination.warnings]
      });
   }

   async function download(previewed: OculusDownloadPreview, operationId: OperationId, signal: AbortSignal) {
      const root = await Result.tryPromise({
         try: () => mkdir(previewed.installRoot, { recursive: true }),
         catch: (cause) => createProblem('downloads.oculus.destination-unavailable', { path: previewed.installRoot, cause })
      });
      if (Result.isError(root)) return Result.err<DownloadSummary, Problem>(root.error);

      const managed = await resolveManagedPath({ root: previewed.installRoot, path: previewed.destinationPath });
      if (Result.isError(managed)) {
         return Result.err<DownloadSummary, Problem>(createProblem('downloads.oculus.destination-rejected', { path: previewed.destinationPath }));
      }

      options.operations.update(operationId, { progress: { phase: 'authenticating', percent: 0, unit: 'bytes' } });

      const token = await options.requestToken({ signal });
      if (Result.isError(token)) return Result.err<DownloadSummary, Problem>(token.error);

      const request = { fetch: fetchBinary, maxAttempts, signal };
      const payload = await fetchMetaPayload(
         metaManifestUrl(previewed.binaryId, token.value),
         { ...request, failure: createProblem('downloads.oculus.manifest-unavailable') },
         maxManifestEntryBytes
      );
      if (Result.isError(payload)) return Result.err<DownloadSummary, Problem>(payload.error);

      const manifest = parseOculusManifest(payload.value);
      if (Result.isError(manifest))
         return Result.err<DownloadSummary, Problem>(createProblem('downloads.oculus.manifest-invalid', { cause: manifest.error }));

      const reserved = await Result.tryPromise({
         try: () => mkdir(managed.value.path),
         catch: (cause) => createProblem('downloads.oculus.destination-unavailable', { path: managed.value.path, cause })
      });
      if (Result.isError(reserved)) return Result.err<DownloadSummary, Problem>(reserved.error);

      const files = Object.entries(manifest.value.files);
      const batchAbort = new AbortController();
      const onOuterAbort = () => batchAbort.abort();
      if (signal.aborted) batchAbort.abort();
      else signal.addEventListener('abort', onOuterAbort, { once: true });

      const state: DownloadState = {
         binaryId: previewed.binaryId,
         token: token.value,
         destinationPath: managed.value.path,
         operationId,
         request: { ...request, signal: batchAbort.signal },
         totalBytes: files.reduce((total, [, file]) => total + file.size, 0),
         bytes: 0,
         files: 0,
         totalFiles: files.length,
         lastReportAt: 0
      };

      const downloaded = await downloadFiles(files, state, batchAbort);
      signal.removeEventListener('abort', onOuterAbort);
      if (Result.isError(downloaded)) {
         await Result.tryPromise({ try: () => rm(state.destinationPath, { recursive: true, force: true }), catch: () => null });
         return Result.err<DownloadSummary, Problem>(downloaded.error);
      }

      reportProgress(state, true);
      return Result.ok<DownloadSummary, Problem>({ bytes: state.bytes, files: state.files });
   }

   async function downloadFiles(files: [string, OculusManifestFile][], state: DownloadState, batchAbort: AbortController) {
      let next = 0;
      let failure: Problem | null = null;

      const worker = async () => {
         for (;;) {
            const index = next;
            next += 1;
            const entry = files[index];
            if (!entry || failure) return;

            const written = await downloadFile(entry[0], entry[1], state);
            if (Result.isError(written)) {
               failure ??= written.error;
               batchAbort.abort();
               return;
            }
         }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

      return failure ? Result.err<void, Problem>(failure) : Result.ok<void, Problem>(undefined);
   }

   async function downloadFile(name: string, file: OculusManifestFile, state: DownloadState) {
      const filePath = join(state.destinationPath, name);
      if (!isPathInside(state.destinationPath, filePath)) {
         return Result.err<void, Problem>(createProblem('downloads.oculus.file-rejected', { name }));
      }

      const prepared = await Result.tryPromise({
         try: () => mkdir(dirname(filePath), { recursive: true }),
         catch: (cause) => createProblem('downloads.oculus.destination-unavailable', { path: dirname(filePath), cause })
      });
      if (Result.isError(prepared)) return Result.err<void, Problem>(prepared.error);

      const handle = await Result.tryPromise({
         try: () => open(filePath, 'w'),
         catch: (cause) => createProblem('downloads.oculus.write-failed', { path: filePath, cause })
      });
      if (Result.isError(handle)) return Result.err<void, Problem>(handle.error);

      let hash = createHash('sha256');
      let fileBytes = 0;
      let written: Result<void, Problem> = Result.ok<void, Problem>(undefined);

      for (const [, segmentSha256, compressedBytes] of file.segments) {
         const remainingBytes = file.size - fileBytes;
         if (remainingBytes < 0) {
            written = integrityFailure(name, 'size');
            break;
         }

         const segment = await writeSegment({
            url: metaSegmentUrl(state.binaryId, state.token, segmentSha256),
            request: state.request,
            stagingPath: state.destinationPath,
            compressedBytes,
            destination: handle.value,
            hash,
            offset: fileBytes,
            maxInflatedBytes: Math.min(maxSegmentBytes, remainingBytes)
         });
         if (Result.isError(segment)) {
            written = Result.err<void, Problem>(segment.error);
            break;
         }

         hash = segment.value.hash;
         fileBytes += segment.value.bytes;
         state.bytes += segment.value.bytes;
         reportProgress(state);
      }

      if (Result.isOk(written) && fileBytes !== file.size) written = integrityFailure(name, 'size');

      const closed = await Result.tryPromise({
         try: () => handle.value.close(),
         catch: (cause) => createProblem('downloads.oculus.write-failed', { path: filePath, cause })
      });
      if (Result.isOk(written) && Result.isError(closed)) written = Result.err<void, Problem>(closed.error);
      if (Result.isError(written)) return written;

      if (hash.digest('hex') !== file.sha256) return integrityFailure(name, 'checksum');

      state.files += 1;
      reportProgress(state);
      return Result.ok<void, Problem>(undefined);
   }

   function reportProgress(state: DownloadState, force = false) {
      const now = Date.now();
      if (!force && now - state.lastReportAt < 200) return;
      state.lastReportAt = now;

      options.operations.update(state.operationId, {
         progress: {
            phase: 'downloading',
            current: state.bytes,
            total: state.totalBytes,
            percent: state.totalBytes > 0 ? Math.min(100, Math.round((state.bytes / state.totalBytes) * 100)) : 0,
            unit: 'bytes',
            label: translate('common.operation.fileCount', { done: state.files, total: state.totalFiles })
         }
      });
   }

   return { preview, download };
}

type DownloadSummary = { bytes: number; files: number };

function integrityFailure(name: string, mismatch: 'size' | 'checksum') {
   return Result.err<void, Problem>(createProblem('downloads.oculus.integrity-failed', { name, detail: mismatch }));
}
