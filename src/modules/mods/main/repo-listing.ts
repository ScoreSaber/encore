import { Result } from 'better-result';
import semver from 'semver';
import { z } from 'zod';

import { parseArchiveEntryPath } from '@/lib/archive/path';
import { causeMessage } from '@/lib/errors';
import { fetchJsonDocument, type JsonDocumentFetch } from '@/lib/http/json';
import { resolveHttpsUrl } from '@/lib/http/url';
import { evaluateHttpsUrl } from '@/lib/security/external-url';
import { modCategories, modPlatformSchema, officialModSourceId, type ModPlatform } from '@/modules/mods/contract';
import { modRepositoryLimits, modRepositoryListingSchemaVersion, modRepositoryProblem, type ModRepositoryProblem } from '@/modules/mods/contract';
import { modIndexKey, toModLinks, type ModIndexEntry, type ModIndexFileMatch } from '@/modules/mods/main/mod-index';
import { modFolders } from '@/modules/mods/main/mod-paths';

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const listingHashSchema = z.discriminatedUnion('algorithm', [
   z.object({ algorithm: z.literal('md5'), value: z.string().trim().pipe(z.hash('md5')) }),
   z.object({ algorithm: z.literal('sha256'), value: z.string().trim().pipe(z.hash('sha256')) })
]);

const listingFileSchema = z.object({
   path: z.string().trim().min(1).max(512),
   hash: listingHashSchema
});

const listingDependencySchema = z
   .string()
   .trim()
   .min(1)
   .max(120)
   .refine((dependency) => !dependency.startsWith(`${officialModSourceId}:`) || /^beatmods:[1-9]\d*$/.test(dependency), {
      message: 'a BeatMods dependency must use beatmods:<mod id>'
   });

const listingIdentitySchema = z
   .string()
   .trim()
   .regex(/^beatmods:[1-9]\d*$/, 'an identity must use beatmods:<mod id>');

const listingVersionSchema = z.object({
   version: z.string().trim().min(1).max(64),
   gameVersions: z.array(z.string().trim().min(1)).max(64).default([]),
   platforms: z.array(modPlatformSchema).max(8).default([]),
   downloadUrl: z.string().trim().min(1).max(2048),
   fileSizeBytes: z.int().nonnegative().optional(),
   hash: listingHashSchema,
   dependencies: z.array(listingDependencySchema).max(64).default([]),
   files: z.array(listingFileSchema).min(1).max(modRepositoryLimits.maxFilesPerVersion)
});

const listingPackageSchema = z.object({
   id: z.string().trim().min(1).max(120),
   identity: listingIdentitySchema.optional(),
   name: z.string().trim().min(1).max(120),
   summary: z.string().trim().max(512).default(''),
   description: z.string().max(20_000).catch('').default(''),
   iconUrl: z.string().trim().max(2048).nullish(),
   category: z.string().trim().max(64).default('other'),
   author: z.string().trim().max(120).default(''),
   sourceUrl: z.string().trim().max(2048).nullish(),
   issuesUrl: z.string().trim().max(2048).nullish(),
   versions: z.array(listingVersionSchema.nullable().catch(null)).min(1).max(modRepositoryLimits.maxVersionsPerPackage)
});

export const modRepositoryListingSchema = z.object({
   schemaVersion: z.literal(modRepositoryListingSchemaVersion),
   id: z.string().trim().min(1).max(120),
   name: z.string().trim().min(1).max(120),
   owner: z.string().trim().min(1).max(120),
   contactUrl: z.string().trim().max(2048).nullish(),
   infoUrl: z.string().trim().max(2048).nullish(),
   packages: z.array(listingPackageSchema.nullable().catch(null)).max(modRepositoryLimits.maxPackages)
});

export type ModRepositoryListing = z.infer<typeof modRepositoryListingSchema>;
export type ModRepositoryPackage = z.infer<typeof listingPackageSchema>;
export type ModRepositoryVersion = z.infer<typeof listingVersionSchema>;

export type FetchListingRequest = {
   url: string;
   etag?: string | null;
   lastModified?: string | null;
   signal?: AbortSignal;
   fetchJson?: JsonDocumentFetch;
};

export type FetchedListing =
   | { status: 'ok'; listing: ModRepositoryListing; etag: string | null; lastModified: string | null }
   | { status: 'not-modified' };

export async function fetchRepositoryListing(request: FetchListingRequest): Promise<Result<FetchedListing, ModRepositoryProblem>> {
   const url = URL.canParse(request.url) ? new URL(request.url) : null;
   if (url?.protocol === 'file:') return readLocalRepositoryListing(url, request.signal);

   const document = await fetchJsonDocument({
      url: request.url,
      etag: request.etag,
      lastModified: request.lastModified,
      maxBytes: modRepositoryLimits.maxListingBytes,
      signal: request.signal,
      fetchJson: request.fetchJson
   });
   if (Result.isError(document)) {
      return Result.err<FetchedListing, ModRepositoryProblem>(
         modRepositoryProblem(document.error.code === 'json.unsupported-url' ? 'invalid-url' : 'fetch-failed', describeProblem(document.error))
      );
   }

   if (document.value.status === 'not-modified') return Result.ok<FetchedListing, ModRepositoryProblem>({ status: 'not-modified' });

   const parsed = parseRepositoryListing(document.value.value);
   if (Result.isError(parsed)) return Result.err<FetchedListing, ModRepositoryProblem>(parsed.error);

   return Result.ok<FetchedListing, ModRepositoryProblem>({
      status: 'ok',
      listing: parsed.value,
      etag: document.value.etag,
      lastModified: document.value.lastModified
   });
}

async function readLocalRepositoryListing(url: URL, signal?: AbortSignal): Promise<Result<FetchedListing, ModRepositoryProblem>> {
   const resolvedPath = Result.try({
      try: () => fileURLToPath(url),
      catch: (cause): ModRepositoryProblem => modRepositoryProblem('invalid-url', causeMessage(cause))
   });
   if (Result.isError(resolvedPath)) return Result.err<FetchedListing, ModRepositoryProblem>(resolvedPath.error);

   const fileStats = await Result.tryPromise({
      try: () => stat(resolvedPath.value),
      catch: (cause): ModRepositoryProblem => modRepositoryProblem('fetch-failed', causeMessage(cause))
   });
   if (Result.isError(fileStats)) return Result.err<FetchedListing, ModRepositoryProblem>(fileStats.error);
   if (!fileStats.value.isFile()) {
      return Result.err<FetchedListing, ModRepositoryProblem>(modRepositoryProblem('fetch-failed', 'the local repository listing is not a file'));
   }
   if (fileStats.value.size > modRepositoryLimits.maxListingBytes) {
      return Result.err<FetchedListing, ModRepositoryProblem>(modRepositoryProblem('invalid-listing', 'the local repository listing is too large'));
   }

   const contents = await Result.tryPromise({
      try: () => readFile(resolvedPath.value, { encoding: 'utf8', ...(signal ? { signal } : {}) }),
      catch: (cause): ModRepositoryProblem => modRepositoryProblem('fetch-failed', causeMessage(cause))
   });
   if (Result.isError(contents)) return Result.err<FetchedListing, ModRepositoryProblem>(contents.error);
   if (Buffer.byteLength(contents.value) > modRepositoryLimits.maxListingBytes) {
      return Result.err<FetchedListing, ModRepositoryProblem>(modRepositoryProblem('invalid-listing', 'the local repository listing is too large'));
   }

   const document = Result.try({
      try: (): unknown => JSON.parse(contents.value),
      catch: (cause): ModRepositoryProblem => modRepositoryProblem('invalid-listing', causeMessage(cause))
   });
   if (Result.isError(document)) return Result.err<FetchedListing, ModRepositoryProblem>(document.error);

   const listing = parseRepositoryListing(document.value);
   if (Result.isError(listing)) return Result.err<FetchedListing, ModRepositoryProblem>(listing.error);

   return Result.ok<FetchedListing, ModRepositoryProblem>({
      status: 'ok',
      listing: listing.value,
      etag: null,
      lastModified: fileStats.value.mtime.toUTCString()
   });
}

export function parseRepositoryListing(value: unknown): Result<ModRepositoryListing, ModRepositoryProblem> {
   const parsed = modRepositoryListingSchema.safeParse(value);
   if (parsed.success) return Result.ok<ModRepositoryListing, ModRepositoryProblem>(parsed.data);

   const wrongVersion = parsed.error.issues.some((issue) => issue.path[0] === 'schemaVersion');

   return Result.err<ModRepositoryListing, ModRepositoryProblem>(
      wrongVersion
         ? modRepositoryProblem('unsupported-schema', `Encore reads listing schema ${modRepositoryListingSchemaVersion}`)
         : modRepositoryProblem('invalid-listing', parsed.error.issues[0]?.message)
   );
}

export function listingPackageCount(listing: ModRepositoryListing) {
   return listing.packages.filter((entry) => entry !== null).length;
}

export function selectRepositoryEntries(
   listing: ModRepositoryListing,
   request: { gameVersion: string; platform: ModPlatform }
): { entries: ModIndexEntry[]; fileMatches: ModIndexFileMatch[]; downloadHosts: string[] } {
   const entries: ModIndexEntry[] = [];
   const fileMatches: ModIndexFileMatch[] = [];
   const downloadHosts = new Set<string>();

   for (const listed of listing.packages) {
      if (!listed) continue;

      const versions = matchingVersions(listed, request).sort((first, second) => compareVersions(first.version, second.version));
      const version = versions.at(-1);
      if (!version) continue;

      const files = resolveListingFiles(version);
      const download = readDownloadUrl(version.downloadUrl);
      if (!files || !download) continue;

      const modId = modIndexKey(listing.id, listed.id);
      downloadHosts.add(download.host);
      entries.push({
         modId,
         packageId: listed.id,
         sourceId: listing.id,
         sourceName: listing.name,
         sourceKind: 'unofficial',
         name: listed.name,
         summary: listed.summary,
         description: listed.description,
         iconUrl: readHttpsUrl(listed.iconUrl),
         links: toModLinks([
            { kind: 'source', url: listed.sourceUrl },
            { kind: 'issues', url: listed.issuesUrl }
         ]),
         category: modCategories.find((category) => category === listed.category.trim().toLowerCase()) ?? 'other',
         author: listed.author,
         version: version.version,
         sizeBytes: version.fileSizeBytes ?? null,
         isBsipa: false,
         claimedIdentity: listed.identity ?? null,
         dependencies: version.dependencies.map((dependencyId) => resolveDependencyId(listing.id, dependencyId)),
         downloadUrl: download.url,
         downloadHost: download.host,
         archiveHash: version.hash,
         files
      });

      for (const candidate of versions) {
         const candidateFiles = resolveListingFiles(candidate);
         if (!candidateFiles || !readDownloadUrl(candidate.downloadUrl)) continue;

         fileMatches.push(...candidateFiles.map((file) => ({ hash: file.hash, modId, version: candidate.version })));
      }
   }

   return { entries, fileMatches, downloadHosts: [...downloadHosts] };
}

function matchingVersions(listed: ModRepositoryPackage, request: { gameVersion: string; platform: ModPlatform }) {
   return listed.versions.filter((version) => version !== null).filter((version) => fitsInstall(version, request));
}

function resolveDependencyId(listingId: string, dependencyId: string) {
   return dependencyId.startsWith(`${officialModSourceId}:`) ? dependencyId : modIndexKey(listingId, dependencyId);
}

function fitsInstall(version: ModRepositoryVersion, request: { gameVersion: string; platform: ModPlatform }) {
   const fitsVersion = version.gameVersions.length === 0 || version.gameVersions.includes(request.gameVersion);
   const fitsPlatform = version.platforms.length === 0 || version.platforms.includes(request.platform) || version.platforms.includes('universalpc');

   return fitsVersion && fitsPlatform;
}

function compareVersions(first: string, second: string) {
   const parsedFirst = semver.coerce(first);
   const parsedSecond = semver.coerce(second);
   if (parsedFirst && parsedSecond) return semver.compare(parsedFirst, parsedSecond);

   return first.localeCompare(second);
}

function resolveListingFiles(version: ModRepositoryVersion) {
   const files: ModIndexEntry['files'] = [];

   for (const file of version.files) {
      const parsed = parseArchiveEntryPath(file.path);
      if (Result.isError(parsed)) return null;

      const segments = parsed.value.segments;
      if (segments[0] !== modFolders.plugins && segments[0] !== modFolders.libs) return null;

      files.push({ path: segments.join('/'), hash: file.hash });
   }

   return files.length > 0 ? files : null;
}

function readDownloadUrl(input: string) {
   const resolved = resolveHttpsUrl(input);
   if (Result.isError(resolved)) return null;

   return { url: resolved.value.toString(), host: resolved.value.hostname };
}

function readHttpsUrl(input: string | null | undefined) {
   const decision = evaluateHttpsUrl(input?.trim() ?? '');

   return decision.allowed ? decision.url : null;
}

function describeProblem(problem: { message: string; detail?: string }) {
   return problem.detail ? `${problem.message} (${problem.detail})` : problem.message;
}
