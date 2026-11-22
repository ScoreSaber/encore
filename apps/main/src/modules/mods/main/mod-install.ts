import { Result } from 'better-result';

import { hashFile } from '@/lib/content/content-hash';
import type { ContentIngestionService } from '@/lib/content/content-ingestion';
import type { ArchiveManifest, ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { copyPathWithProgress } from '@/lib/filesystem/operations';
import { downloadHostsFor } from '@/lib/http/url';
import type { ReadyModImportPreview } from '@/modules/mods/contract';
import type { ModIndexEntry, ModIndexFile } from '@/modules/mods/main/mod-index';
import { modFileExtensions, modFolders, resolveModContentPath } from '@/modules/mods/main/mod-paths';
import type { OperationProgress } from '@/modules/operations/contract';

import { extname } from 'node:path';

export const maxModArchiveBytes = 128 * 1024 * 1024;

export const modContentLimits = {
   maxDownloadBytes: maxModArchiveBytes,
   maxArchiveBytes: maxModArchiveBytes,
   maxEntries: 2_000,
   maxEntryBytes: 128 * 1024 * 1024,
   maxTotalBytes: 256 * 1024 * 1024
};

type ModWriteSummary = {
   files: number;
   bytes: number;
};

type InstallModVersionRequest = {
   ingestion: ContentIngestionService;
   installPath: string;
   entry: ModIndexEntry;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

type ImportModRequest = {
   ingestion: ContentIngestionService;
   installPath: string;
   sourcePath: string;
   kind: ReadyModImportPreview['kind'];
   name: string;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export async function installModVersion(request: InstallModVersionRequest): Promise<Result<ModWriteSummary, ContentProblem>> {
   const staged = await request.ingestion.ingestArchive({
      source: { kind: 'url', url: request.entry.downloadUrl },
      expectedHash: request.entry.archiveHash ?? undefined,
      limits: modContentLimits,
      urlPolicy: { allowedHosts: downloadHostsFor(request.entry.downloadHost) },
      signal: request.signal,
      onProgress: request.onProgress,
      validate: ({ extractedPath }) => verifyModContents(extractedPath, request.entry.files)
   });
   if (Result.isError(staged)) return Result.err(staged.error);

   const placed = await placeModFiles(staged.value.extractedPath, request);
   await staged.value.dispose();

   return placed;
}

export function importMod(request: ImportModRequest) {
   return request.kind === 'zip' ? importModArchive(request) : importModFile(request);
}

async function importModArchive(request: ImportModRequest): Promise<Result<ModWriteSummary, ContentProblem>> {
   const staged = await request.ingestion.ingestArchive({
      source: { kind: 'file', path: request.sourcePath },
      limits: modContentLimits,
      signal: request.signal,
      onProgress: request.onProgress,
      validate: ({ manifest }) => validateImportLayout(manifest)
   });
   if (Result.isError(staged)) return Result.err(staged.error);

   const paths = staged.value.manifest.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path);
   const placed = await copyModFiles(
      paths.map((path) => ({ contentPath: path, destinationPath: modImportDestination(path) ?? path })),
      staged.value.extractedPath,
      request.installPath,
      request.signal
   );
   await staged.value.dispose();

   return placed;
}

async function importModFile(request: ImportModRequest): Promise<Result<ModWriteSummary, ContentProblem>> {
   const destination = resolveModContentPath(request.installPath, `${modFolders.pluginsPending}/${request.name}`);
   if (!destination) {
      return Result.err(createProblem('content.ingest.mod-file-name', { entry: request.name }));
   }

   const copied = await copyPathWithProgress({
      sourcePath: request.sourcePath,
      destinationPath: destination.absolutePath,
      destinationRoot: request.installPath,
      overwrite: true,
      signal: request.signal
   });

   return Result.isError(copied)
      ? Result.err(createProblem('content.commit.failed', { path: destination.relativePath, detail: copied.error.code }))
      : Result.ok({ files: copied.value.files, bytes: copied.value.bytes });
}

async function verifyModContents(extractedPath: string, files: ModIndexFile[]): Promise<Result<void, ContentProblem>> {
   for (const file of files) {
      const source = resolveModContentPath(extractedPath, file.path);
      if (!source) {
         return Result.err(createProblem('content.ingest.mod-path-rejected', { entry: file.path }));
      }

      const digest = await hashFile(source.absolutePath, file.hash.algorithm);
      if (Result.isError(digest)) {
         return Result.err(createProblem('content.ingest.mod-file-missing', { entry: file.path }));
      }

      if (digest.value.toLowerCase() !== file.hash.value.toLowerCase()) {
         return Result.err(createProblem('content.extract.checksum-mismatch', { entry: file.path }));
      }
   }

   return Result.ok();
}

function validateImportLayout(manifest: ArchiveManifest): Result<void, ContentProblem> {
   const paths = manifest.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path);
   if (paths.length === 0) {
      return Result.err(createProblem('content.ingest.mod-empty'));
   }

   for (const path of paths) {
      if (modImportDestination(path)) continue;

      return Result.err(createProblem('content.ingest.mod-outside-folders', { entry: path }));
   }

   return paths.some((path) => extname(path).toLowerCase() === '.dll') ? Result.ok() : Result.err(createProblem('content.ingest.mod-no-plugin'));
}

function modImportDestination(contentPath: string) {
   const segments = contentPath.split('/');
   if (!modFileExtensions.includes(extname(contentPath).toLowerCase())) return null;

   if (segments.length === 1) return `${modFolders.pluginsPending}/${contentPath}`;
   if (segments[0] === modFolders.plugins || segments[0] === modFolders.libs) return `${modFolders.pending}/${contentPath}`;

   return null;
}

function placeModFiles(extractedPath: string, request: InstallModVersionRequest) {
   const files = request.entry.files.map((file) => ({
      contentPath: file.path,
      destinationPath: request.entry.isBsipa ? file.path : `${modFolders.pending}/${file.path}`
   }));

   return copyModFiles(files, extractedPath, request.installPath, request.signal);
}

async function copyModFiles(
   files: { contentPath: string; destinationPath: string }[],
   extractedPath: string,
   installPath: string,
   signal?: AbortSignal
): Promise<Result<ModWriteSummary, ContentProblem>> {
   let count = 0;
   let bytes = 0;

   for (const file of files) {
      const source = resolveModContentPath(extractedPath, file.contentPath);
      const destination = resolveModContentPath(installPath, file.destinationPath);
      if (!source || !destination) {
         return Result.err(createProblem('content.ingest.mod-path-rejected', { entry: file.contentPath }));
      }

      const copied = await copyPathWithProgress({
         sourcePath: source.absolutePath,
         destinationPath: destination.absolutePath,
         destinationRoot: installPath,
         overwrite: true,
         signal
      });
      if (Result.isError(copied)) {
         return Result.err(createProblem('content.commit.failed', { path: destination.relativePath, detail: copied.error.code }));
      }

      count += copied.value.files;
      bytes += copied.value.bytes;
   }

   return Result.ok({ files: count, bytes });
}
