import { Result } from 'better-result';

import { extractZipArchive } from '@/lib/content/archive-extraction';
import { inspectZipArchive } from '@/lib/content/archive-inspection';
import { downloadContent, type ContentFetch } from '@/lib/content/content-download';
import type { ContentResult } from '@/lib/content/content-errors';
import { hashFile, verifyFileHash } from '@/lib/content/content-hash';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import { createContentStaging, type ContentStaging, type StagingArea } from '@/lib/content/content-staging';
import type { ArchiveManifest, ContentHash, ContentProblem, ContentProblemCode, ContentSource } from '@/lib/content/contract';
import { copyPathWithProgress, type FilesystemWriteSummary } from '@/lib/filesystem/operations';
import { readPathInfo, toSafeFileName } from '@/lib/filesystem/path';
import type { HttpsUrlPolicy } from '@/lib/http/url';
import type { OperationProgress } from '@/modules/operations/contract';

import { copyFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';

export type ContentIngestionService = ReturnType<typeof createContentIngestionService>;

export type ArchiveLayoutValidator = (input: {
   manifest: ArchiveManifest;
   extractedPath: string;
}) => ContentResult<void> | Promise<ContentResult<void>>;

export type IngestArchiveRequest = {
   source: ContentSource;
   targetKind?: 'local' | 'remote';
   expectedHash?: ContentHash;
   limits?: Partial<ContentLimits>;
   urlPolicy?: HttpsUrlPolicy;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
   validate?: ArchiveLayoutValidator;
};

export type CommitStagedContentRequest = {
   destinationPath: string;
   destinationRoot: string;
   overwrite?: boolean;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export type StagedFileValidator = (input: { path: string; fileName: string; bytes: number }) => ContentResult<void> | Promise<ContentResult<void>>;

export type IngestFileRequest = {
   source: ContentSource;
   targetKind?: 'local' | 'remote';
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
   commit: (request: CommitStagedContentRequest) => Promise<ContentResult<FilesystemWriteSummary>>;
   dispose: () => Promise<void>;
};

export type StagedArchive = {
   archivePath: string;
   extractedPath: string;
   manifest: ArchiveManifest;
   bytes: number;
   sha256: string;
   commit: (request: CommitStagedContentRequest) => Promise<ContentResult<FilesystemWriteSummary>>;
   dispose: () => Promise<void>;
};

export type ContentIngestionOptions = {
   dataPath: string;
   limits?: Partial<ContentLimits>;
   fetchContent?: ContentFetch;
   staging?: ContentStaging;
};

const stagedArchiveFileName = 'source.zip';
const stagedSingleFileName = 'source.bin';
const extractedDirectoryName = 'extracted';

export function createContentIngestionService(options: ContentIngestionOptions) {
   const staging = options.staging ?? createContentStaging({ dataPath: options.dataPath });
   const serviceLimits = resolveContentLimits(options.limits);

   async function ingestArchive(request: IngestArchiveRequest): Promise<ContentResult<StagedArchive>> {
      const unsupported = describeUnsupportedIngestion(request);
      if (unsupported) return Result.err<StagedArchive, ContentProblem>(unsupported);

      const limits = request.limits ? resolveContentLimits({ ...options.limits, ...request.limits }) : serviceLimits;
      const area = await staging.create('ingest');
      if (Result.isError(area)) return Result.err<StagedArchive, ContentProblem>(area.error);

      const staged = await stageArchive(request, limits, area.value);
      if (Result.isError(staged)) {
         await area.value.dispose();
         return Result.err<StagedArchive, ContentProblem>(staged.error);
      }

      return Result.ok<StagedArchive, ContentProblem>(staged.value);
   }

   async function stageArchive(request: IngestArchiveRequest, limits: ContentLimits, area: StagingArea): Promise<ContentResult<StagedArchive>> {
      const archivePath = join(area.path, stagedArchiveFileName);
      const acquired = await acquireArchive(request, limits, archivePath);
      if (Result.isError(acquired)) return Result.err<StagedArchive, ContentProblem>(acquired.error);

      if (request.expectedHash) {
         const verified = await verifyFileHash({ path: archivePath, expected: request.expectedHash });
         if (Result.isError(verified)) return Result.err<StagedArchive, ContentProblem>(verified.error);
      }

      const inspection = await inspectZipArchive({ archivePath, limits });
      if (Result.isError(inspection)) return Result.err<StagedArchive, ContentProblem>(inspection.error);

      const extractedPath = join(area.path, extractedDirectoryName);
      const extracted = await extractZipArchive({
         inspection: inspection.value,
         destinationPath: extractedPath,
         limits,
         signal: request.signal,
         onProgress: request.onProgress
      });
      if (Result.isError(extracted)) return Result.err<StagedArchive, ContentProblem>(extracted.error);

      const manifest = inspection.value.manifest;
      const validated = await request.validate?.({ manifest, extractedPath });
      if (validated && Result.isError(validated)) return Result.err<StagedArchive, ContentProblem>(validated.error);

      return Result.ok<StagedArchive, ContentProblem>({
         archivePath,
         extractedPath,
         manifest,
         bytes: acquired.value.bytes,
         sha256: acquired.value.sha256,
         commit: (commitRequest) => commitStagedPath(extractedPath, area, commitRequest),
         dispose: area.dispose
      });
   }

   async function acquireArchive(request: IngestArchiveRequest, limits: ContentLimits, archivePath: string) {
      if (request.source.kind === 'url') {
         const downloaded = await downloadContent({
            url: request.source.url,
            destinationPath: archivePath,
            limits,
            policy: request.urlPolicy,
            signal: request.signal,
            onProgress: request.onProgress,
            fetchContent: options.fetchContent
         });

         return Result.isError(downloaded)
            ? Result.err<{ bytes: number; sha256: string }, ContentProblem>(downloaded.error)
            : Result.ok<{ bytes: number; sha256: string }, ContentProblem>({ bytes: downloaded.value.bytes, sha256: downloaded.value.sha256 });
      }

      return copyIntoStaging(request.source.path, archivePath, limits.maxArchiveBytes, 'content.archive.too-large');
   }

   async function ingestFile(request: IngestFileRequest): Promise<ContentResult<StagedFile>> {
      const unsupported = describeUnsupportedIngestion(request);
      if (unsupported) return Result.err<StagedFile, ContentProblem>(unsupported);

      const limits = request.limits ? resolveContentLimits({ ...options.limits, ...request.limits }) : serviceLimits;
      const area = await staging.create('ingest');
      if (Result.isError(area)) return Result.err<StagedFile, ContentProblem>(area.error);

      const staged = await stageFile(request, limits, area.value);
      if (Result.isError(staged)) {
         await area.value.dispose();
         return Result.err<StagedFile, ContentProblem>(staged.error);
      }

      return Result.ok<StagedFile, ContentProblem>(staged.value);
   }

   async function stageFile(request: IngestFileRequest, limits: ContentLimits, area: StagingArea): Promise<ContentResult<StagedFile>> {
      const stagedPath = join(area.path, stagedSingleFileName);
      const acquired = await acquireFile(request, limits, stagedPath);
      if (Result.isError(acquired)) return Result.err<StagedFile, ContentProblem>(acquired.error);

      if (request.expectedHash) {
         const verified = await verifyFileHash({ path: stagedPath, expected: request.expectedHash });
         if (Result.isError(verified)) return Result.err<StagedFile, ContentProblem>(verified.error);
      }

      const fileName = toSafeFileName(request.fileName ?? acquired.value.fileName ?? '', 'download');
      const validated = await request.validate?.({ path: stagedPath, fileName, bytes: acquired.value.bytes });
      if (validated && Result.isError(validated)) return Result.err<StagedFile, ContentProblem>(validated.error);

      return Result.ok<StagedFile, ContentProblem>({
         path: stagedPath,
         fileName,
         bytes: acquired.value.bytes,
         sha256: acquired.value.sha256,
         commit: (commitRequest) => commitStagedPath(stagedPath, area, commitRequest),
         dispose: area.dispose
      });
   }

   async function acquireFile(request: IngestFileRequest, limits: ContentLimits, stagedPath: string) {
      if (request.source.kind === 'url') {
         const downloaded = await downloadContent({
            url: request.source.url,
            destinationPath: stagedPath,
            limits,
            policy: request.urlPolicy,
            signal: request.signal,
            onProgress: request.onProgress,
            fetchContent: options.fetchContent
         });

         if (Result.isError(downloaded)) return Result.err<StagedSource, ContentProblem>(downloaded.error);

         return Result.ok<StagedSource, ContentProblem>({
            bytes: downloaded.value.bytes,
            sha256: downloaded.value.sha256,
            fileName: downloaded.value.fileName ?? decodeUrlFileName(request.source.url)
         });
      }

      const copied = await copyIntoStaging(request.source.path, stagedPath, limits.maxDownloadBytes, 'content.download.too-large');
      if (Result.isError(copied)) return Result.err<StagedSource, ContentProblem>(copied.error);

      return Result.ok<StagedSource, ContentProblem>({ ...copied.value, fileName: basename(request.source.path) });
   }

   return { staging, ingestArchive, ingestFile };
}

type StagedSource = { bytes: number; sha256: string; fileName: string | null };

export function describeUnsupportedIngestion(request: Pick<IngestArchiveRequest, 'source' | 'targetKind'>): ContentProblem | null {
   if (request.targetKind !== 'remote' || request.source.kind !== 'file') return null;

   return {
      code: 'content.ingest.unsupported-target',
      message: 'files on this computer cannot be sent to a paired target yet',
      detail: 'remote-file-upload'
   };
}

async function copyIntoStaging(sourcePath: string, stagedPath: string, maxBytes: number, tooLargeCode: ContentProblemCode) {
   const info = await readPathInfo(sourcePath);
   if (Result.isError(info) || info.value.kind !== 'file') {
      return Result.err<{ bytes: number; sha256: string }, ContentProblem>({
         code: 'content.source.not-a-file',
         message: 'the selected file could not be read',
         path: sourcePath
      });
   }

   if (info.value.sizeBytes > maxBytes) {
      return Result.err<{ bytes: number; sha256: string }, ContentProblem>({
         code: tooLargeCode,
         message: 'the selected file is larger than the allowed size',
         path: sourcePath,
         detail: `${maxBytes} bytes`
      });
   }

   const copied = await Result.tryPromise({
      try: async () => {
         await mkdir(dirname(stagedPath), { recursive: true });
         await copyFile(sourcePath, stagedPath);
      },
      catch: (cause): ContentProblem => ({
         code: 'content.download.write-failed',
         message: 'the file could not be copied into staging',
         path: basename(sourcePath),
         detail: String(cause)
      })
   });
   if (Result.isError(copied)) return Result.err<{ bytes: number; sha256: string }, ContentProblem>(copied.error);

   const digest = await hashFile(stagedPath);
   if (Result.isError(digest)) return Result.err<{ bytes: number; sha256: string }, ContentProblem>(digest.error);

   return Result.ok<{ bytes: number; sha256: string }, ContentProblem>({ bytes: info.value.sizeBytes, sha256: digest.value });
}

function decodeUrlFileName(url: string) {
   const parsed = URL.canParse(url) ? new URL(url) : null;
   if (!parsed) return null;

   const decoded = Result.try({
      try: () => decodeURIComponent(posix.basename(parsed.pathname)),
      catch: () => null
   });

   return Result.isOk(decoded) && decoded.value.trim() ? decoded.value : null;
}

async function commitStagedPath(
   stagedPath: string,
   area: StagingArea,
   request: CommitStagedContentRequest
): Promise<ContentResult<FilesystemWriteSummary>> {
   const copied = await copyPathWithProgress({
      sourcePath: stagedPath,
      destinationPath: request.destinationPath,
      destinationRoot: request.destinationRoot,
      overwrite: request.overwrite ?? false,
      scope: 'content',
      signal: request.signal,
      onProgress: request.onProgress
   });

   await area.dispose();

   if (Result.isError(copied)) {
      return Result.err<FilesystemWriteSummary, ContentProblem>({
         code: 'content.commit.failed',
         message: 'the unpacked content could not be copied into place',
         path: copied.error.path,
         detail: copied.error.code
      });
   }

   return Result.ok<FilesystemWriteSummary, ContentProblem>(copied.value);
}
