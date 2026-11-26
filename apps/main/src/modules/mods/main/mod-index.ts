import semver from 'semver';

import type { ContentHash, ContentHashAlgorithm } from '@/lib/content/contract';
import { evaluateHttpsUrl } from '@/lib/security/external-url';
import {
   beatModsHost,
   beatModsOrigin,
   bsipaModName,
   officialModSourceId,
   officialModSourceName,
   type ModCatalogSource,
   type ModCategory,
   type ModLink,
   type ModLinkKind,
   type ModPlatform,
   type ModSourceKind,
   type ModSourceResolutionSettings,
   type ModSourceStatus,
   type ModSummary
} from '@/modules/mods/contract';
import type { BeatModsEntry } from '@/modules/mods/main/beatmods-api';

export type ModIndexFile = {
   path: string;
   hash: ContentHash;
};

export type ModIndexFileMatch = {
   hash: ContentHash;
   modId: string;
   version: string;
};

export type ModIndexEntry = {
   modId: string;
   packageId: string;
   sourceId: string;
   sourceName: string;
   sourceKind: ModSourceKind;
   name: string;
   summary: string;
   description: string;
   iconUrl: string | null;
   links: ModLink[];
   category: ModCategory;
   author: string;
   version: string;
   sizeBytes: number | null;
   isBsipa: boolean;
   claimedIdentity: string | null;
   dependencies: string[];
   downloadUrl: string;
   mirrorUrl?: string;
   downloadHost: string;
   archiveHash: ContentHash | null;
   files: ModIndexFile[];
};

export type ModIndex = {
   gameVersion: string;
   platform: ModPlatform;
   source: ModCatalogSource;
   updatedAt: string;
   sources: ModSourceStatus[];
   entries: ModIndexEntry[];
   byModId: Map<string, ModIndexEntry>;
   byFileHash: Map<string, Pick<ModIndexEntry, 'modId' | 'version'>>;
   hashAlgorithms: ContentHashAlgorithm[];
};

export function modIndexKey(sourceId: string, packageId: string) {
   return `${sourceId}:${packageId}`;
}

export function fileHashKey(hash: ContentHash) {
   return `${hash.algorithm}:${hash.value.toLowerCase()}`;
}

export type RepositoryModEntries = {
   sources: ModSourceStatus[];
   entries: ModIndexEntry[];
   fileMatches: ModIndexFileMatch[];
   resolution: ModSourceResolutionSettings;
};

export function composeModIndex(
   request: { gameVersion: string; platform: ModPlatform; source: ModCatalogSource; fetchedAt: number },
   official: { sources: ModSourceStatus[]; entries: ModIndexEntry[] },
   repositories: RepositoryModEntries
) {
   const resolved = resolveModIdentities(
      { entries: [...official.entries, ...repositories.entries], fileMatches: repositories.fileMatches },
      repositories.resolution
   );

   return buildModIndex({
      gameVersion: request.gameVersion,
      platform: request.platform,
      source: request.source,
      updatedAt: new Date(request.fetchedAt).toISOString(),
      sources: [...official.sources, ...repositories.sources],
      entries: resolved.entries,
      fileMatches: resolved.fileMatches
   });
}

function resolveModIdentities(input: { entries: ModIndexEntry[]; fileMatches: ModIndexFileMatch[] }, settings: ModSourceResolutionSettings) {
   if (!settings.combine) return input;

   const candidatesByIdentity = new Map<string, ModIndexEntry[]>();
   const canonicalIdByModId = new Map<string, string>();

   for (const entry of input.entries) {
      const canonicalId = entry.claimedIdentity ?? entry.modId;
      canonicalIdByModId.set(entry.modId, canonicalId);

      const candidates = candidatesByIdentity.get(canonicalId) ?? [];
      candidates.push(entry);
      candidatesByIdentity.set(canonicalId, candidates);
   }

   const groups = [...candidatesByIdentity].map(([modId, candidates]) => ({
      modId,
      candidates,
      selected: selectIdentityCandidate(candidates, settings.strategy)
   }));
   const entries = groups.map(({ modId, selected }) => ({
      ...selected,
      modId,
      dependencies: selected.dependencies.map((dependencyId) => canonicalIdByModId.get(dependencyId) ?? dependencyId)
   }));
   const fileMatches: ModIndexFileMatch[] = input.fileMatches.map((match) => ({
      ...match,
      modId: canonicalIdByModId.get(match.modId) ?? match.modId
   }));

   for (const { modId, candidates, selected } of groups) {
      if (candidates.length < 2) continue;

      for (const candidate of [...candidates.filter((entry) => entry !== selected), selected]) {
         fileMatches.push(...candidate.files.map((file) => ({ hash: file.hash, modId, version: candidate.version })));
      }
   }

   return { entries, fileMatches };
}

export function buildModIndex(input: {
   gameVersion: string;
   platform: ModPlatform;
   source: ModCatalogSource;
   updatedAt: string;
   sources: ModSourceStatus[];
   entries: ModIndexEntry[];
   fileMatches?: ModIndexFileMatch[];
}): ModIndex {
   const { fileMatches = [], ...index } = input;
   const byModId = new Map<string, ModIndexEntry>();
   const byFileHash = new Map<string, Pick<ModIndexEntry, 'modId' | 'version'>>();
   const algorithms = new Set<ContentHashAlgorithm>();

   for (const entry of input.entries) {
      if (!byModId.has(entry.modId)) byModId.set(entry.modId, entry);

      for (const file of entry.files) {
         const key = fileHashKey(file.hash);
         if (!byFileHash.has(key)) byFileHash.set(key, entry);
         algorithms.add(file.hash.algorithm);
      }
   }

   for (const match of fileMatches) {
      byFileHash.set(fileHashKey(match.hash), { modId: match.modId, version: match.version });
      algorithms.add(match.hash.algorithm);
   }

   return { ...index, byModId, byFileHash, hashAlgorithms: [...algorithms] };
}

export function toModIndexEntries(entries: BeatModsEntry[]): ModIndexEntry[] {
   return entries.map(({ project, version }) => {
      const packageId = String(project.id);
      const author = project.authors.find(({ id }) => id === version.uploaderId) ?? project.authors[0];

      return {
         modId: modIndexKey(officialModSourceId, packageId),
         packageId,
         sourceId: officialModSourceId,
         sourceName: officialModSourceName,
         sourceKind: 'official',
         name: project.name,
         summary: project.summary,
         description: project.description,
         iconUrl: project.iconFileUrl,
         links: toModLinks([
            { kind: 'listing', url: new URL(`/mods/${project.id}`, beatModsOrigin).href },
            { kind: 'source', url: project.gitUrl }
         ]),
         category: project.category,
         author: author?.displayName || author?.username || '',
         version: version.semver,
         sizeBytes: version.fileSize,
         isBsipa: project.name.toLowerCase() === bsipaModName,
         claimedIdentity: null,
         dependencies: version.dependencies.map(({ pId }) => modIndexKey(officialModSourceId, String(pId))),
         downloadUrl: version.downloadUrl,
         mirrorUrl: new URL(`/cdn/mod/${version.zipHash}.zip`, beatModsOrigin).href,
         downloadHost: beatModsHost,
         archiveHash: { algorithm: 'md5', value: version.zipHash },
         files: version.contentHashes.map((content) => ({ path: content.path, hash: { algorithm: 'md5', value: content.hash } }))
      };
   });
}

export function toModSummary(entry: ModIndexEntry, installedVersion: string | null, state: ModSummary['state']): ModSummary {
   return {
      modId: entry.modId,
      sourceId: entry.sourceId,
      sourceName: entry.sourceName,
      sourceKind: entry.sourceKind,
      name: entry.name,
      summary: entry.summary,
      description: entry.description,
      iconUrl: entry.iconUrl,
      links: entry.links,
      category: entry.category,
      author: entry.author,
      state,
      latestVersion: entry.version,
      installedVersion,
      sizeBytes: entry.sizeBytes,
      isBsipa: entry.isBsipa,
      isRequired: entry.category === 'core' || entry.category === 'essential' || entry.category === 'library',
      dependencyIds: entry.dependencies,
      claimedIdentity: entry.claimedIdentity
   };
}

export function toModLinks(candidates: { kind: ModLinkKind; url: string | null | undefined }[]): ModLink[] {
   const links: ModLink[] = [];

   for (const candidate of candidates) {
      const decision = evaluateHttpsUrl(candidate.url?.trim() ?? '');
      if (decision.allowed) links.push({ kind: candidate.kind, url: decision.url });
   }

   return links;
}

function selectIdentityCandidate(candidates: ModIndexEntry[], strategy: ModSourceResolutionSettings['strategy']) {
   const first = candidates[0];
   if (!first) throw new Error('an identity group cannot be empty');

   return candidates.slice(1).reduce((selected, candidate) => {
      if (strategy === 'prefer-unofficial' && selected.sourceKind !== candidate.sourceKind) {
         return candidate.sourceKind === 'unofficial' ? candidate : selected;
      }

      const compared = compareVersions(candidate.version, selected.version);
      if (compared !== 0) return compared > 0 ? candidate : selected;
      if (selected.sourceKind !== candidate.sourceKind) return candidate.sourceKind === 'official' ? candidate : selected;

      return selected;
   }, first);
}

export function compareVersions(first: string, second: string) {
   const parsedFirst = semver.coerce(first);
   const parsedSecond = semver.coerce(second);
   if (parsedFirst && parsedSecond) return semver.compare(parsedFirst, parsedSecond);

   return first.localeCompare(second);
}
