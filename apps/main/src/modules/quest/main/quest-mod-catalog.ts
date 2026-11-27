import { Result } from 'better-result';
import { z } from 'zod';

import { readRecent, setRecent } from '@/lib/content/content-cache';
import { createProblem, type Problem } from '@/lib/errors';
import { fetchJsonDocument } from '@/lib/http/json';
import { resolveHttpsUrl } from '@/lib/http/url';
import { translate } from '@/lib/messages';
import { questModRepoHost, questModSourceId, questModSourceName, type ModCatalogSource, type ModSourceStatus } from '@/modules/mods/contract';
import {
   buildModIndex,
   compareVersions,
   composeModIndex,
   modIndexKey,
   toModLinks,
   type ModIndex,
   type ModIndexEntry
} from '@/modules/mods/main/mod-index';
import type { ModRepositoryService } from '@/modules/mods/main/repo-service';
import { dependencySatisfied } from '@/modules/quest/main/quest-mod-install';

const ttlMs = 10 * 60 * 1000;
const maxCachedCatalogs = 4;
const fetchTimeoutMs = 30_000;
const maxListingBytes = 16 * 1024 * 1024;
const maxResolvePasses = 8;

export const questCoreModsUrl = 'https://raw.githubusercontent.com/QuestPackageManager/bs-coremods/main/core_mods.json';
const questGlobalModsUrl = `https://${questModRepoHost}/global.json`;

const questRepoModSchema = z.object({
   id: z.string().min(1),
   name: z.string().min(1),
   version: z.string().min(1),
   download: z.string().min(1),
   source: z.string().nullish(),
   author: z.string().nullish(),
   cover: z.string().nullish(),
   description: z.string().nullish(),
   modloader: z.string().nullish(),
   isLibrary: z.boolean().default(false),
   hash: z
      .string()
      .regex(/^[a-f\d]{40}$/i)
      .nullish(),
   dependencies: z.array(z.object({ id: z.string().min(1), version: z.string().default('*') })).default([])
});
const questRepoListingSchema = z.record(z.string(), z.record(z.string(), questRepoModSchema));
type QuestRepoListing = z.infer<typeof questRepoListingSchema>;

const questCoreModsSchema = z.record(
   z.string(),
   z.object({
      mods: z
         .array(
            z.object({
               id: z.string().min(1),
               version: z.string().min(1),
               downloadLink: z.string().min(1)
            })
         )
         .default([])
   })
);

type QuestRepoMod = z.infer<typeof questRepoModSchema>;

export type QuestCatalogFetchJson = (url: string) => Promise<Result<unknown, Problem>>;

export type QuestModCatalog = ReturnType<typeof createQuestModCatalog>;

export function createQuestModCatalog(options: {
   repositories: Pick<ModRepositoryService, 'listEntries' | 'isQuestModsEnabled'>;
   fetchJson?: QuestCatalogFetchJson;
}) {
   const fetchJson = options.fetchJson ?? fetchQuestJson;
   const catalogs = new Map<string, { entries: ModIndexEntry[]; fetchedAt: number }>();
   const inFlight = new Map<string, Promise<Result<ModIndex, Problem>>>();

   async function get(gameVersion: string): Promise<Result<ModIndex, Problem>> {
      if (!(await options.repositories.isQuestModsEnabled())) return compose(gameVersion, [], 'remote', Date.now());
      const cached = readRecent(catalogs, gameVersion);
      if (cached && Date.now() - cached.fetchedAt < ttlMs) {
         return compose(gameVersion, cached.entries, 'cache', cached.fetchedAt);
      }

      return refresh(gameVersion);
   }

   function refresh(gameVersion: string, request: { requiredCore?: boolean } = {}): Promise<Result<ModIndex, Problem>> {
      const key = `${gameVersion}\0${Boolean(request.requiredCore)}`;
      const existing = inFlight.get(key);
      if (existing) return existing;

      const pending = runRefresh(gameVersion, request).finally(() => {
         if (inFlight.get(key) === pending) inFlight.delete(key);
      });
      inFlight.set(key, pending);
      return pending;
   }

   async function runRefresh(gameVersion: string, request: { requiredCore?: boolean } = {}): Promise<Result<ModIndex, Problem>> {
      if (!request.requiredCore && !(await options.repositories.isQuestModsEnabled())) return compose(gameVersion, [], 'remote', Date.now());
      const [listing, globalMods, coreMods] = await Promise.all([
         fetchJson(`https://${questModRepoHost}/${encodeURIComponent(gameVersion)}.json`),
         fetchJson(questGlobalModsUrl),
         fetchJson(questCoreModsUrl)
      ]);

      let listingData: QuestRepoListing = {};
      let listingComplete = true;
      if (Result.isOk(listing)) {
         const parsed = questRepoListingSchema.safeParse(listing.value);
         if (!parsed.success) {
            if (!request.requiredCore) return fallback(gameVersion, createProblem('quest.catalog.invalid-listing'));
            listingComplete = false;
         } else {
            listingData = parsed.data;
         }
      } else if (listing.error.code !== 'quest.catalog.not-found') {
         if (!request.requiredCore) return fallback(gameVersion, listing.error);
         listingComplete = false;
      }

      const global = Result.isOk(globalMods) ? questRepoListingSchema.safeParse(globalMods.value) : null;
      const globalListing = global?.success ? global.data : {};
      const coreIds = coreModIdsFor(coreMods, gameVersion);
      if (Result.isError(coreIds) && request.requiredCore) return Result.err(coreIds.error);
      const entries = toQuestIndexEntries(listingData, globalListing, coreIds.unwrapOr(new Map()));
      const fetchedAt = Date.now();
      if (listingComplete) setRecent(catalogs, gameVersion, { entries, fetchedAt }, maxCachedCatalogs);
      if (request.requiredCore)
         return Result.ok(
            buildModIndex({
               gameVersion,
               platform: 'quest',
               source: 'remote',
               updatedAt: new Date(fetchedAt).toISOString(),
               sources: [{ id: questModSourceId, name: questModSourceName, kind: 'official', state: 'ready', modCount: entries.length }],
               entries
            })
         );
      return compose(gameVersion, entries, 'remote', fetchedAt);
   }

   async function fallback(gameVersion: string, error: Problem) {
      const cached = readRecent(catalogs, gameVersion);
      const index = await compose(gameVersion, cached?.entries ?? [], cached ? 'cache' : 'remote', cached?.fetchedAt ?? Date.now(), error);
      return index.value.entries.length > 0 ? index : Result.err(error);
   }

   async function compose(gameVersion: string, entries: ModIndexEntry[], source: ModCatalogSource, fetchedAt: number, error?: Problem) {
      const repositories = await options.repositories.listEntries({ gameVersion, platform: 'quest' });
      const official: ModSourceStatus = error
         ? {
              id: questModSourceId,
              name: questModSourceName,
              kind: 'official',
              state: 'unavailable',
              modCount: entries.length,
              issue: 'fetch-failed',
              detail: error.message
           }
         : { id: questModSourceId, name: questModSourceName, kind: 'official', state: 'ready', modCount: entries.length };
      return Result.ok(composeModIndex({ gameVersion, platform: 'quest', source, fetchedAt }, { sources: [official], entries }, repositories));
   }

   return { get, refresh };
}

function coreModIdsFor(
   coreMods: Result<unknown, Problem>,
   gameVersion: string
): Result<Map<string, { version: string; downloadLink: string }>, Problem> {
   if (Result.isError(coreMods)) return Result.err(coreMods.error);

   const parsed = questCoreModsSchema.safeParse(coreMods.value);
   if (!parsed.success) return Result.err(createProblem('quest.catalog.invalid-listing'));

   const forVersion = parsed.data[gameVersion] ?? parsed.data[gameVersion.split('_')[0] ?? gameVersion];
   return Result.ok(new Map((forVersion?.mods ?? []).map((mod) => [mod.id, { version: mod.version, downloadLink: mod.downloadLink }])));
}

const extraCoreModIds = ['flamingo'];

function toQuestIndexEntries(
   versionListing: QuestRepoListing,
   globalListing: QuestRepoListing,
   coreMods: Map<string, { version: string; downloadLink: string }>
): ModIndexEntry[] {
   const scotland2 = (versions: Record<string, QuestRepoMod>) =>
      Object.values(versions).filter((mod) => mod.modloader?.toLowerCase() === 'scotland2');
   const listed = Object.entries(versionListing).map(([id, versions]) => ({ id, versions: scotland2(versions), floating: false }));
   const floating = Object.entries(globalListing)
      .filter(([id]) => !(id in versionListing))
      .map(([id, versions]) => ({ id, versions: scotland2(versions), floating: true }));

   const picked = new Map<string, QuestRepoMod>();
   const pick = ({ id, versions, floating }: (typeof listed)[number], ranges: string[]) => {
      const core = coreMods.get(id);
      if (core) {
         const pinned = versions.find((mod) => mod.version === core.version);
         const base = pinned ?? pickLatest(versions);
         return base && { ...base, version: core.version, download: core.downloadLink, hash: pinned?.hash, dependencies: pinned?.dependencies ?? [] };
      }
      const wanted = floating ? versions.filter((mod) => ranges.every((range) => dependencySatisfied(mod.version, range))) : versions;
      return pickLatest(wanted) ?? pickLatest(versions);
   };

   for (const listing of listed) {
      const mod = pick(listing, []);
      if (mod) picked.set(listing.id, mod);
   }
   for (let pass = 0; pass < maxResolvePasses; pass++) {
      const ranges = new Map<string, string[]>();
      for (const mod of picked.values()) {
         for (const dependency of mod.dependencies) ranges.set(dependency.id, [...(ranges.get(dependency.id) ?? []), dependency.version]);
      }

      let changed = false;
      for (const listing of floating) {
         const wanted = ranges.get(listing.id);
         if (!wanted) continue;
         const mod = pick(listing, wanted);
         if (!mod || mod.version === picked.get(listing.id)?.version) continue;
         picked.set(listing.id, mod);
         changed = true;
      }
      if (!changed) break;
   }

   const core = new Set([...coreMods.keys(), ...extraCoreModIds.filter((id) => picked.has(id))]);
   for (const id of core) {
      for (const dependency of picked.get(id)?.dependencies ?? []) core.add(dependency.id);
   }

   const entries = [...picked].flatMap(([id, mod]) => toEntry(mod, core.has(id)) ?? []);
   for (const [id, coreMod] of coreMods) {
      if (picked.has(id)) continue;

      const entry = toEntry(
         {
            id,
            name: id,
            version: coreMod.version,
            download: coreMod.downloadLink,
            description: translate('quest.catalog.coreMod'),
            isLibrary: false,
            dependencies: []
         },
         true
      );
      if (entry) entries.push(entry);
   }

   return entries;
}

function toEntry(mod: QuestRepoMod, isCore: boolean): ModIndexEntry | null {
   const download = resolveHttpsUrl(mod.download);
   if (Result.isError(download)) return null;

   const cover = mod.cover && URL.canParse(mod.cover) ? new URL(mod.cover) : null;
   if (cover?.hostname === questModRepoHost && cover.protocol === 'http:') cover.protocol = 'https:';

   return {
      modId: modIndexKey(questModSourceId, mod.id),
      packageId: mod.id,
      sourceId: questModSourceId,
      sourceName: questModSourceName,
      sourceKind: 'official',
      name: mod.name,
      summary: mod.description ?? '',
      description: mod.description ?? '',
      iconUrl: cover?.protocol === 'https:' && !cover.username && !cover.password ? cover.toString() : null,
      links: toModLinks([{ kind: 'source', url: mod.source }]),
      category: isCore ? 'core' : mod.isLibrary ? 'library' : 'other',
      author: mod.author ?? '',
      version: mod.version,
      sizeBytes: null,
      isBsipa: false,
      claimedIdentity: null,
      dependencies: mod.dependencies.map((dependency) => modIndexKey(questModSourceId, dependency.id)),
      downloadUrl: download.value.toString(),
      downloadHost: download.value.hostname.toLowerCase(),
      archiveHash: mod.hash ? { algorithm: 'sha1', value: mod.hash } : null,
      files: []
   };
}

function pickLatest(versions: QuestRepoMod[]) {
   return versions.reduce<QuestRepoMod | null>(
      (latest, candidate) => (latest && compareVersions(candidate.version, latest.version) <= 0 ? latest : candidate),
      null
   );
}

export async function fetchQuestJson(url: string): Promise<Result<unknown, Problem>> {
   const response = await fetchJsonDocument({
      url,
      maxBytes: maxListingBytes,
      timeoutMs: fetchTimeoutMs
   });
   if (Result.isError(response)) {
      const cause = response.error.detail;
      return Result.err(
         response.error.code === 'json.not-found'
            ? createProblem('quest.catalog.not-found', { cause })
            : createProblem('quest.catalog.fetch-failed', { cause })
      );
   }

   if (response.value.status === 'not-modified') {
      return Result.err(createProblem('quest.catalog.empty'));
   }

   return Result.ok(response.value.value);
}
