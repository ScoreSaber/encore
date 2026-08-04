import { Result } from 'better-result';

import type { ContentResult } from '@/lib/content/content-errors';
import { hashFile } from '@/lib/content/content-hash';
import type { ContentIngestionService } from '@/lib/content/content-ingestion';
import type { ArchiveManifest, ContentProblem } from '@/lib/content/contract';
import { copyPathWithProgress } from '@/lib/filesystem/operations';
import type { ModIndexEntry, ModIndexFile } from '@/modules/mods/main/mod-index';
import { modFileExtensions, modFolders, resolveModContentPath } from '@/modules/mods/main/mod-paths';
import type { OperationProgress } from '@/modules/operations/contract';

import { extname } from 'node:path';

export const maxModArchiveBytes = 128 * 1024 * 1024;
const githubHost = 'github.com';
const githubReleaseAssetsHost = 'release-assets.githubusercontent.com';

export const modContentLimits = {
   maxDownloadBytes: maxModArchiveBytes,
   maxArchiveBytes: maxModArchiveBytes,
   maxEntries: 2_000,
   maxEntryBytes: 64 * 1024 * 1024,
   maxTotalBytes: 256 * 1024 * 1024
};

export type ModWriteSummary = {
   files: number;
   bytes: number;
};

export type InstallModVersionRequest = {
   ingestion: ContentIngestionService;
   installPath: string;
   entry: ModIndexEntry;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export type ImportModArchiveRequest = {
   ingestion: ContentIngestionService;
   installPath: string;
   sourcePath: string;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
};

export async function installModVersion(request: InstallModVersionRequest): Promise<ContentResult<ModWriteSummary>> {
   const staged = await request.ingestion.ingestArchive({
      source: { kind: 'url', url: request.entry.downloadUrl },
      targetKind: 'local',
      expectedHash: request.entry.archiveHash,
      limits: modContentLimits,
      urlPolicy: {
         allowedHosts:
            request.entry.downloadHost === githubHost ? [request.entry.downloadHost, githubReleaseAssetsHost] : [request.entry.downloadHost]
      },
      signal: request.signal,
      onProgress: request.onProgress,
      validate: ({ extractedPath }) => verifyModContents(extractedPath, request.entry.files)
   });
   if (Result.isError(staged)) return Result.err<ModWriteSummary, ContentProblem>(staged.error);

   const placed = await placeModFiles(staged.value.extractedPath, request);
   await staged.value.dispose();

   return placed;
}

export async function importModArchive(request: ImportModArchiveRequest): Promise<ContentResult<ModWriteSummary>> {
   const staged = await request.ingestion.ingestArchive({
      source: { kind: 'file', path: request.sourcePath },
      targetKind: 'local',
      limits: modContentLimits,
      signal: request.signal,
      onProgress: request.onProgress,
      validate: ({ manifest }) => validateImportLayout(manifest)
   });
   if (Result.isError(staged)) return Result.err<ModWriteSummary, ContentProblem>(staged.error);

   const paths = importedModPaths(staged.value.manifest);
   const placed = await copyModFiles(
      paths.map((path) => ({ contentPath: path, destinationPath: modImportDestination(path) ?? path })),
      staged.value.extractedPath,
      request.installPath,
      request.signal
   );
   await staged.value.dispose();

   return placed;
}

async function verifyModContents(extractedPath: string, files: ModIndexFile[]): Promise<ContentResult<void>> {
   for (const file of files) {
      const source = resolveModContentPath(extractedPath, file.path);
      if (!source) {
         return Result.err<void, ContentProblem>({
            code: 'content.ingest.layout-rejected',
            message: 'the mod lists a file path Encore will not write',
            entry: file.path
         });
      }

      const digest = await hashFile(source.absolutePath, file.hash.algorithm);
      if (Result.isError(digest)) {
         return Result.err<void, ContentProblem>({
            code: 'content.ingest.layout-rejected',
            message: 'a file the mod lists is missing from its archive',
            entry: file.path
         });
      }

      if (digest.value.toLowerCase() !== file.hash.value.toLowerCase()) {
         return Result.err<void, ContentProblem>({
            code: 'content.extract.checksum-mismatch',
            message: 'a file in the mod archive does not match the hash its source published',
            entry: file.path
         });
      }
   }

   return Result.ok<void, ContentProblem>(undefined);
}

function validateImportLayout(manifest: ArchiveManifest): ContentResult<void> {
   const paths = importedModPaths(manifest);
   if (paths.length === 0) {
      return Result.err<void, ContentProblem>({
         code: 'content.ingest.layout-rejected',
         message: 'the archive has no mod files in it'
      });
   }

   for (const path of paths) {
      if (modImportDestination(path)) continue;

      return Result.err<void, ContentProblem>({
         code: 'content.ingest.layout-rejected',
         message: 'the archive holds files outside the Plugins and Libs folders',
         entry: path
      });
   }

   return paths.some((path) => extname(path).toLowerCase() === '.dll')
      ? Result.ok<void, ContentProblem>(undefined)
      : Result.err<void, ContentProblem>({ code: 'content.ingest.layout-rejected', message: 'the archive has no plugin in it' });
}

function importedModPaths(manifest: ArchiveManifest) {
   return manifest.entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path);
}

export function modImportDestination(contentPath: string) {
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
): Promise<ContentResult<ModWriteSummary>> {
   let count = 0;
   let bytes = 0;

   for (const file of files) {
      const source = resolveModContentPath(extractedPath, file.contentPath);
      const destination = resolveModContentPath(installPath, file.destinationPath);
      if (!source || !destination) {
         return Result.err<ModWriteSummary, ContentProblem>({
            code: 'content.ingest.layout-rejected',
            message: 'the mod lists a file path Encore will not write',
            entry: file.contentPath
         });
      }

      const copied = await copyPathWithProgress({
         sourcePath: source.absolutePath,
         destinationPath: destination.absolutePath,
         destinationRoot: installPath,
         overwrite: true,
         scope: 'content',
         signal
      });
      if (Result.isError(copied)) {
         return Result.err<ModWriteSummary, ContentProblem>({
            code: 'content.commit.failed',
            message: 'a mod file could not be written into the install',
            path: destination.relativePath,
            detail: copied.error.code
         });
      }

      count += copied.value.files;
      bytes += copied.value.bytes;
   }

   return Result.ok<ModWriteSummary, ContentProblem>({ files: count, bytes });
}
