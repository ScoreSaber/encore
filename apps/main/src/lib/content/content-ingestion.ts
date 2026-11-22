import { Result } from 'better-result';

import { abortedBy } from '@/lib/async';
import { extractZipArchive } from '@/lib/content/archive-extraction';
import { inspectZipArchive } from '@/lib/content/archive-inspection';
import { downloadContent, type ContentFetch, type DownloadedContent } from '@/lib/content/content-download';
import { hashFile, verifyFileHash } from '@/lib/content/content-hash';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import { createContentStaging, type ContentStaging, type StagingArea } from '@/lib/content/content-staging';
import type { ArchiveManifest, ContentHash, ContentProblem, ContentSource } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { copyPathWithProgress, type FilesystemWriteSummary } from '@/lib/filesystem/operations';
import { readPathInfo, toSafeFileName } from '@/lib/filesystem/path';
import type { HttpsUrlPolicy } from '@/lib/http/url';
import type { OperationProgress } from '@/modules/operations/contract';

import { copyFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

export type ContentIngestionService = ReturnType<typeof createContentIngestionService>;

export type ArchiveLayoutValidator = (input: {
   manifest: ArchiveManifest;
   extractedPath: string;
}) => Result<void, ContentProblem> | Promise<Result<void, ContentProblem>>;

export type IngestArchiveRequest = {
   source: ContentSource;
   expectedHash?: ContentHash;
   limits?: Partial<ContentLimits>;
   urlPolicy?: HttpsUrlPolicy;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
   validate?: ArchiveLayoutValidator;
};

type CommitStagedContentRequest = {
   destinationPath: string;
   destinationRoot: string;
   overwrite?: boolean;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

type StagedFileValidator = (input: {
   path: string;
   fileName: string;
   bytes: number;
}) => Result<void, ContentProblem> | Promise<Result<void, ContentProblem>>;

export type IngestFileRequest = {
   source: ContentSource;
   fileName?: string;
   expectedHash?: ContentHash;
   limits?: Partial<ContentLimits>;
   urlPolicy?: HttpsUrlPolicy;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
   validate?: StagedFileValidator;
};

export type StagedFile = {
   path: string;
   fileName: string;
   bytes: number;
   sha256: string;
   commit: (request: CommitStagedContentRequest) => Promise<Result<FilesystemWriteSummary, ContentProblem>>;
   dispose: () => Promise<void>;
};

export type StagedArchive = {
   archivePath: string;
   extractedPath: string;
   manifest: ArchiveManifest;
   bytes: number;
   sha256: string;
   commit: (request: CommitStagedContentRequest) => Promise<Result<FilesystemWriteSummary, ContentProblem>>;
   dispose: () => Promise<void>;
};

type ContentIngestionOptions = {
   dataPath: string;
   limits?: Partial<ContentLimits>;
   fetchContent?: ContentFetch;
   staging?: ContentStaging;
};

const stagedArchiveFileName = 'source.zip';
const stagedSingleFileName = 'source.bin';
const extractedDirectoryName = 'extracted';

type SharedDownload = {
   fetched: Promise<Result<DownloadedContent & { dispose: () => Promise<void> }, ContentProblem>>;
   listeners: Map<symbol, (progress: OperationProgress) => void>;
   waiting: number;
   settled: boolean;
   disposed: boolean;
   abort: AbortController;
};
type SharedDownloadRequest = {
   url: string;
   limits: ContentLimits;
   policy: HttpsUrlPolicy | undefined;
   signal: AbortSignal | undefined;
   onProgress: ((progress: OperationProgress) => void) | undefined;
};

export function createContentIngestionService(options: ContentIngestionOptions) {
   const staging = options.staging ?? createContentStaging({ dataPath: options.dataPath });
   const serviceLimits = resolveContentLimits(options.limits);
   const sharedDownloads = new Map<string, SharedDownload>();

   async function download(request: SharedDownloadRequest, destinationPath: string): Promise<Result<DownloadedContent, ContentProblem>> {
      if (request.signal?.aborted) return Result.err(createProblem('content.download.cancelled'));

      const key = [
         request.url,
         request.limits.maxDownloadBytes,
         request.limits.requestTimeoutMs,
         request.limits.stallTimeoutMs,
         request.limits.maxRedirects,
         ...(request.policy?.allowedHosts ?? [])
      ].join('\0');
      const shared = sharedDownloads.get(key) ?? startShared(key, request);
      const listenerToken = Symbol();
      shared.waiting += 1;
      if (request.onProgress) shared.listeners.set(listenerToken, request.onProgress);

      const cancelled = abortedBy<ContentProblem>(request.signal, () => createProblem('content.download.cancelled'));
      const fetched: Result<DownloadedContent & { dispose: () => Promise<void> }, ContentProblem> = await Promise.race([
         shared.fetched,
         cancelled.result
      ]);
      cancelled.release();
      shared.listeners.delete(listenerToken);
      const copied = Result.isError(fetched)
         ? Result.err<DownloadedContent, ContentProblem>(fetched.error)
         : request.signal?.aborted
           ? Result.err<DownloadedContent, ContentProblem>(createProblem('content.download.cancelled'))
           : await copyDownload(fetched.value, destinationPath, request.signal);
      shared.waiting -= 1;
      if (shared.waiting === 0 && !shared.settled) {
         shared.abort.abort();
         if (sharedDownloads.get(key) === shared) sharedDownloads.delete(key);
      }
      void shared.fetched.then((result) => {
         if (shared.waiting === 0 && !shared.disposed && Result.isOk(result)) {
            shared.disposed = true;
            void result.value.dispose();
         }
      });
      return copied;
   }

   function startShared(key: string, request: SharedDownloadRequest) {
      const listeners = new Map<symbol, (progress: OperationProgress) => void>();
      const abort = new AbortController();
      const shared: SharedDownload = {
         fetched: fetchShared(request, listeners, abort.signal),
         listeners,
         waiting: 0,
         settled: false,
         disposed: false,
         abort
      };
      sharedDownloads.set(key, shared);
      void shared.fetched.finally(() => {
         shared.settled = true;
         if (sharedDownloads.get(key) === shared) sharedDownloads.delete(key);
      });
      return shared;
   }

   function copyDownload(content: DownloadedContent, destinationPath: string, signal?: AbortSignal) {
      return Result.tryPromise({
         try: async (): Promise<DownloadedContent> => {
            await mkdir(dirname(destinationPath), { recursive: true });
            await copyFile(content.path, destinationPath);
            if (signal?.aborted) throw new Error('cancelled');
            return {
               url: content.url,
               bytes: content.bytes,
               sha256: content.sha256,
               fileName: content.fileName,
               contentType: content.contentType,
               path: destinationPath
            };
         },
         catch: (cause): ContentProblem =>
            signal?.aborted
               ? createProblem('content.download.cancelled')
               : createProblem('content.source.copy-failed', { path: basename(destinationPath), cause })
      });
   }

   async function fetchShared(request: SharedDownloadRequest, listeners: Map<symbol, (progress: OperationProgress) => void>, signal: AbortSignal) {
      const area = await staging.create('download');
      if (Result.isError(area)) return Result.err<DownloadedContent & { dispose: () => Promise<void> }, ContentProblem>(area.error);

      const downloaded = await Result.tryPromise({
         try: () =>
            downloadContent({
               url: request.url,
               destinationPath: join(area.value.path, 'content'),
               limits: request.limits,
               policy: request.policy,
               signal,
               onProgress: (progress) => {
                  for (const listener of listeners.values()) listener(progress);
               },
               fetchContent: options.fetchContent
            }),
         catch: (cause): ContentProblem => createProblem('content.download.interrupted', { cause })
      }).then(Result.flatten);
      if (Result.isError(downloaded)) await area.value.dispose();
      return downloaded.map((content) => ({ ...content, dispose: area.value.dispose }));
   }

   async function ingestArchive(request: IngestArchiveRequest): Promise<Result<StagedArchive, ContentProblem>> {
      const limits = request.limits ? resolveContentLimits({ ...options.limits, ...request.limits }) : serviceLimits;
      const area = await staging.create('ingest');
      if (Result.isError(area)) return Result.err<StagedArchive, ContentProblem>(area.error);

      const staged = await stageArchive(request, limits, area.value);
      if (Result.isError(staged)) await area.value.dispose();
      return staged;
   }

   function stageArchive(request: IngestArchiveRequest, limits: ContentLimits, area: StagingArea): Promise<Result<StagedArchive, ContentProblem>> {
      return Result.gen(async function* () {
         const archivePath = join(area.path, stagedArchiveFileName);
         const acquired = yield* Result.await(acquireArchive(request, limits, archivePath));
         if (request.expectedHash) yield* Result.await(verifyAcquiredHash(archivePath, acquired.sha256, request.expectedHash));

         const inspection = yield* Result.await(inspectZipArchive({ archivePath, limits }));
         const extractedPath = join(area.path, extractedDirectoryName);
         yield* Result.await(
            extractZipArchive({ inspection, destinationPath: extractedPath, limits, signal: request.signal, onProgress: request.onProgress })
         );

         const manifest = inspection.manifest;
         const validated = await request.validate?.({ manifest, extractedPath });
         if (validated) yield* validated;

         return Result.ok({
            archivePath,
            extractedPath,
            manifest,
            bytes: acquired.bytes,
            sha256: acquired.sha256,
            commit: (commitRequest: CommitStagedContentRequest) => commitStagedPath(extractedPath, area, commitRequest),
            dispose: area.dispose
         });
      });
   }

   async function acquireArchive(
      request: IngestArchiveRequest,
      limits: ContentLimits,
      archivePath: string
   ): Promise<Result<StagedCopy, ContentProblem>> {
      if (request.source.kind === 'file') return copyIntoStaging(request.source.path, archivePath, limits.maxArchiveBytes);

      const downloaded = await download(
         { url: request.source.url, limits, policy: request.urlPolicy, signal: request.signal, onProgress: request.onProgress },
         archivePath
      );

      return downloaded.map(({ bytes, sha256 }) => ({ bytes, sha256 }));
   }

   async function ingestFile(request: IngestFileRequest): Promise<Result<StagedFile, ContentProblem>> {
      const limits = request.limits ? resolveContentLimits({ ...options.limits, ...request.limits }) : serviceLimits;
      const area = await staging.create('ingest');
      if (Result.isError(area)) return Result.err<StagedFile, ContentProblem>(area.error);

      const staged = await stageFile(request, limits, area.value);
      if (Result.isError(staged)) await area.value.dispose();
      return staged;
   }

   function stageFile(request: IngestFileRequest, limits: ContentLimits, area: StagingArea): Promise<Result<StagedFile, ContentProblem>> {
      return Result.gen(async function* () {
         const stagedPath = join(area.path, stagedSingleFileName);
         const acquired = yield* Result.await(acquireFile(request, limits, stagedPath));
         if (request.expectedHash) yield* Result.await(verifyAcquiredHash(stagedPath, acquired.sha256, request.expectedHash));

         const sourceName = request.fileName ?? acquired.fileName ?? '';
         const extension = extname(sourceName);
         const fileName = `${toSafeFileName(basename(sourceName, extension), 'download')}${toSafeFileName(extension, '')}`;
         const validated = await request.validate?.({ path: stagedPath, fileName, bytes: acquired.bytes });
         if (validated) yield* validated;

         return Result.ok({
            path: stagedPath,
            fileName,
            bytes: acquired.bytes,
            sha256: acquired.sha256,
            commit: (commitRequest: CommitStagedContentRequest) => commitStagedPath(stagedPath, area, commitRequest),
            dispose: area.dispose
         });
      });
   }

   async function acquireFile(request: IngestFileRequest, limits: ContentLimits, stagedPath: string): Promise<Result<StagedSource, ContentProblem>> {
      if (request.source.kind === 'file') {
         const fileName = basename(request.source.path);
         const copied = await copyIntoStaging(request.source.path, stagedPath, limits.maxDownloadBytes);
         return copied.map((copy) => ({ ...copy, fileName }));
      }

      return download(
         { url: request.source.url, limits, policy: request.urlPolicy, signal: request.signal, onProgress: request.onProgress },
         stagedPath
      );
   }

   return { staging, ingestArchive, ingestFile };
}

type StagedCopy = { bytes: number; sha256: string };

type StagedSource = StagedCopy & { fileName: string | null };

function copyIntoStaging(sourcePath: string, stagedPath: string, maxBytes: number): Promise<Result<StagedCopy, ContentProblem>> {
   return Result.gen(async function* () {
      const info = await readPathInfo(sourcePath);
      if (Result.isError(info) || info.value.kind !== 'file') return Result.err(createProblem('content.source.not-a-file', { path: sourcePath }));

      if (info.value.sizeBytes > maxBytes) {
         return Result.err(createProblem('content.source.too-large', { path: sourcePath, detail: `${maxBytes} bytes` }));
      }

      yield* Result.await(
         Result.tryPromise({
            try: async () => {
               await mkdir(dirname(stagedPath), { recursive: true });
               await copyFile(sourcePath, stagedPath);
            },
            catch: (cause): ContentProblem => createProblem('content.source.copy-failed', { path: basename(sourcePath), cause })
         })
      );

      const sha256 = yield* Result.await(hashFile(stagedPath));
      return Result.ok({ bytes: info.value.sizeBytes, sha256 });
   });
}

async function commitStagedPath(
   stagedPath: string,
   area: StagingArea,
   request: CommitStagedContentRequest
): Promise<Result<FilesystemWriteSummary, ContentProblem>> {
   const copied = await copyPathWithProgress({
      sourcePath: stagedPath,
      destinationPath: request.destinationPath,
      destinationRoot: request.destinationRoot,
      overwrite: request.overwrite ?? false,
      signal: request.signal,
      onProgress: request.onProgress
   });

   await area.dispose();

   if (Result.isError(copied)) {
      return Result.err<FilesystemWriteSummary, ContentProblem>(
         createProblem('content.commit.failed', { path: copied.error.path, cause: copied.error })
      );
   }

   return Result.ok<FilesystemWriteSummary, ContentProblem>(copied.value);
}

function verifyAcquiredHash(path: string, sha256: string, expected: ContentHash): Promise<Result<string, ContentProblem>> {
   if (expected.algorithm !== 'sha256') return verifyFileHash({ path, expected });
   if (sha256.toLowerCase() !== expected.value.trim().toLowerCase()) {
      return Promise.resolve(Result.err(createProblem('content.hash.mismatch', { path, detail: `${expected.algorithm} ${sha256}` })));
   }
   return Promise.resolve(Result.ok(sha256));
}
