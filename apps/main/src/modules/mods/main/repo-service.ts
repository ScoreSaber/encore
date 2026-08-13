import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import type { JsonDocumentFetch } from '@/lib/http/json';
import {
   beatModsOrigin,
   officialModSourceId,
   officialModSourceName,
   scoreSaberModSourceId,
   scoreSaberModSourceName,
   scoreSaberModSourceUrl,
   type ModPlatform
} from '@/modules/mods/contract';
import {
   modRepositoryLimits,
   modRepositoryProblem,
   type ModRepositoriesSnapshot,
   type ModRepositoryAddRequest,
   type ModRepositoryIdRequest,
   type ModRepositoryIssue,
   type ModRepositoryPreview,
   type ModRepositoryRecord,
   type ModRepositoryResult,
   type ModRepositorySyncRequest,
   type ModRepositorySyncResult,
   type ModRepositorySummary,
   type ModRepositoryToggleRequest,
   type ModSourceResolutionRequest,
   type ModSourceStatus
} from '@/modules/mods/contract';
import type { ModIndexEntry, ModIndexFileMatch } from '@/modules/mods/main/mod-index';
import {
   fetchRepositoryListing,
   listingPackageCount,
   modRepositoryListingSchema,
   selectRepositoryEntries,
   type ModRepositoryListing
} from '@/modules/mods/main/repo-listing';
import {
   createModRepositoryPolicyService,
   findDenylistEntry,
   isDeniedHost,
   type ModRepositoryPolicyService,
   type ModRepositoryPolicySnapshot
} from '@/modules/mods/main/repo-policy';
import { repositoryUrlHost, resolveRepositoryListingUrl } from '@/modules/mods/main/repo-url';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

import { join } from 'node:path';

const cacheFileName = 'mod-repositories.json';
const modRepositoryCacheVersion = 1;
const listingTtlMs = 30 * 60 * 1000;
const scoreSaberRepository = { id: scoreSaberModSourceId, listingUrl: scoreSaberModSourceUrl };

const cachedListingSchema = z.object({
   id: z.string(),
   listingUrl: z.string(),
   fetchedAt: z.string(),
   etag: z.string().nullable().default(null),
   lastModified: z.string().nullable().default(null),
   listing: modRepositoryListingSchema
});

const listingCacheFileSchema = z.object({
   schemaVersion: z.literal(modRepositoryCacheVersion),
   repositories: z.array(cachedListingSchema.nullable().catch(null)).default([])
});

type CachedListing = z.infer<typeof cachedListingSchema>;

export type ModRepositoryServiceOptions = {
   dataPath: string;
   settingsStore: SettingsStore;
   policy?: ModRepositoryPolicyService;
   fetchJson?: JsonDocumentFetch;
   now?: () => number;
};

export type ModRepositoryService = ReturnType<typeof createModRepositoryService>;

type RepositoryState = {
   cached: CachedListing | null;
   issue?: ModRepositoryIssue;
   detail?: string;
};

function syncFailure(listingUrl: string, issue: ModRepositoryIssue, detail?: string): ModRepositorySyncResult['failures'][number] {
   const failure: ModRepositorySyncResult['failures'][number] = { listingUrl, issue };
   if (detail) failure.detail = detail;
   return failure;
}

export function createModRepositoryService(options: ModRepositoryServiceOptions) {
   const cachePath = join(options.dataPath, cacheFileName);
   const policyService =
      options.policy ?? createModRepositoryPolicyService({ dataPath: options.dataPath, now: options.now, fetchJson: options.fetchJson });
   const now = options.now ?? Date.now;
   const states = new Map<string, RepositoryState>();
   let cacheLoaded = false;

   async function getSnapshot(): Promise<ModRepositoriesSnapshot> {
      const policy = await policyService.get();
      await loadCache();

      return describeSnapshot(policy, await readRecords());
   }

   async function refresh(): Promise<ModRepositoriesSnapshot> {
      const policy = await policyService.refresh();
      const records = await enforcePolicy(policy, await readRecords());
      const official = await readOfficialSources();

      if (official.scoreSaberEnabled) await loadListing(scoreSaberRepository, { force: true });

      for (const record of records) {
         if (!record.enabled || isBlocked(policy, record)) continue;

         await loadListing(record, { force: true });
      }

      return describeSnapshot(policy, records);
   }

   async function preview(input: { url: string }): Promise<ModRepositoryPreview> {
      const resolved = resolveRepositoryListingUrl(input.url);
      if (Result.isError(resolved)) return resolved.error;

      const fetched = await fetchRepositoryListing({ url: resolved.value, fetchJson: options.fetchJson });
      if (Result.isError(fetched)) return fetched.error;
      if (fetched.value.status !== 'ok') return modRepositoryProblem('fetch-failed', 'the listing did not answer with a document');

      const listing = fetched.value.listing;
      if (isScoreSaberRepositoryId(listing.id)) return modRepositoryProblem('duplicate', scoreSaberModSourceUrl);

      const policy = await policyService.get();
      const denied = findDenylistEntry(policy.entries, { id: listing.id, listingUrl: resolved.value });
      if (denied) return modRepositoryProblem('denylisted', denied.reason);

      return describePreview(listing, resolved.value);
   }

   async function add(input: ModRepositoryAddRequest): Promise<ModRepositoryResult> {
      if (!input.acknowledged) return modRepositoryProblem('not-acknowledged');

      const policy = await policyService.get();
      if (policy.state !== 'ready') return modRepositoryProblem('policy-unavailable', policy.detail);

      const resolved = resolveRepositoryListingUrl(input.url);
      if (Result.isError(resolved)) return resolved.error;

      const records = await readRecords();
      if (records.some((record) => record.listingUrl === resolved.value)) return modRepositoryProblem('duplicate', resolved.value);

      const fetched = await fetchRepositoryListing({ url: resolved.value, fetchJson: options.fetchJson });
      if (Result.isError(fetched)) return fetched.error;
      if (fetched.value.status !== 'ok') return modRepositoryProblem('fetch-failed', 'the listing did not answer with a document');

      const listing = fetched.value.listing;
      if (isScoreSaberRepositoryId(listing.id) || records.some((record) => record.id === listing.id)) {
         return modRepositoryProblem('duplicate', listing.id);
      }

      const denied = findDenylistEntry(policy.entries, { id: listing.id, listingUrl: resolved.value });
      if (denied) return modRepositoryProblem('denylisted', denied.reason);

      const addedAt = new Date(now()).toISOString();
      const written = await writeRecords([
         ...records,
         {
            id: listing.id,
            name: listing.name,
            owner: listing.owner,
            listingUrl: resolved.value,
            infoUrl: listing.infoUrl ?? null,
            contactUrl: listing.contactUrl ?? null,
            enabled: true,
            addedAt,
            acknowledgedAt: addedAt
         }
      ]);
      if (!written) return modRepositoryProblem('write-failed');

      await storeListing({
         id: listing.id,
         listingUrl: resolved.value,
         fetchedAt: addedAt,
         etag: fetched.value.etag,
         lastModified: fetched.value.lastModified,
         listing
      });

      return { status: 'ok', snapshot: await describeSnapshot(policy, await readRecords()) };
   }

   async function setEnabled(input: ModRepositoryToggleRequest): Promise<ModRepositoryResult> {
      if (input.id === officialModSourceId || input.id === scoreSaberModSourceId) {
         const written = await options.settingsStore.updateAppSettings(
            input.id === officialModSourceId ? { officialModSourceEnabled: input.enabled } : { scoreSaberModSourceEnabled: input.enabled }
         );
         if (!written.ok) return modRepositoryProblem('write-failed');

         if (input.id === scoreSaberModSourceId && input.enabled) await loadListing(scoreSaberRepository, { force: true });

         return { status: 'ok', snapshot: await describeSnapshot(await policyService.get(), await readRecords()) };
      }

      const records = await readRecords();
      const record = records.find((candidate) => candidate.id === input.id);
      if (!record) return modRepositoryProblem('not-found', input.id);

      const policy = await policyService.get();
      if (input.enabled) {
         if (policy.state !== 'ready') return modRepositoryProblem('policy-unavailable', policy.detail);

         const denied = findDenylistEntry(policy.entries, record);
         if (denied) return modRepositoryProblem('denylisted', denied.reason);
      }

      const written = await writeRecords(
         records.map((candidate) => (candidate.id === input.id ? { ...candidate, enabled: input.enabled } : candidate))
      );
      if (!written) return modRepositoryProblem('write-failed');

      if (input.enabled) await loadListing(record, { force: true });

      return { status: 'ok', snapshot: await describeSnapshot(policy, await readRecords()) };
   }

   async function remove(input: ModRepositoryIdRequest): Promise<ModRepositoryResult> {
      const records = await readRecords();
      if (!records.some((record) => record.id === input.id)) return modRepositoryProblem('not-found', input.id);

      const written = await writeRecords(records.filter((record) => record.id !== input.id));
      if (!written) return modRepositoryProblem('write-failed');

      states.delete(input.id);
      await saveCache();

      return { status: 'ok', snapshot: await describeSnapshot(await policyService.get(), await readRecords()) };
   }

   async function setSourceResolution(input: ModSourceResolutionRequest): Promise<ModRepositoryResult> {
      const written = await options.settingsStore.updateAppSettings({ modSourceResolution: input });
      if (!written.ok) return modRepositoryProblem('write-failed');

      return { status: 'ok', snapshot: await getSnapshot() };
   }

   async function sync(input: ModRepositorySyncRequest): Promise<ModRepositorySyncResult> {
      const failures: ModRepositorySyncResult['failures'] = [];
      const resolution = await setSourceResolution(input.resolution);
      if (resolution.status === 'invalid') {
         failures.push(syncFailure(beatModsOrigin, resolution.issue, resolution.detail));
      }

      for (const desired of input.official) {
         const result = await setEnabled(desired);
         if (result.status === 'invalid') {
            const listingUrl =
               desired.id === officialModSourceId ? beatModsOrigin : desired.id === scoreSaberModSourceId ? scoreSaberModSourceUrl : desired.id;
            failures.push(syncFailure(listingUrl, result.issue, result.detail));
         }
      }

      for (const desired of input.repositories) {
         const records = await readRecords();
         const existing = records.find((record) => record.listingUrl === desired.listingUrl);
         const result = existing
            ? existing.enabled === desired.enabled
               ? null
               : await setEnabled({ id: existing.id, enabled: desired.enabled })
            : await add({ url: desired.listingUrl, acknowledged: true });

         if (result?.status === 'invalid') {
            failures.push(syncFailure(desired.listingUrl, result.issue, result.detail));
            continue;
         }

         if (!existing && !desired.enabled) {
            const added = (await readRecords()).find((record) => record.listingUrl === desired.listingUrl);
            if (!added) continue;

            const disabled = await setEnabled({ id: added.id, enabled: false });
            if (disabled.status === 'invalid') {
               failures.push(syncFailure(desired.listingUrl, disabled.issue, disabled.detail));
            }
         }
      }

      return { snapshot: await getSnapshot(), failures };
   }

   async function listEntries(request: { gameVersion: string; platform: ModPlatform }) {
      const policy = await policyService.get();
      const records = await enforcePolicy(policy, await readRecords());
      const sources: ModSourceStatus[] = [];
      const entries: ModIndexEntry[] = [];
      const fileMatches: ModIndexFileMatch[] = [];
      const official = await readOfficialSources();

      if (official.scoreSaberEnabled) {
         const state = await loadListing(scoreSaberRepository, { force: false });
         if (!state.cached) {
            const source: ModSourceStatus = {
               id: scoreSaberModSourceId,
               name: scoreSaberModSourceName,
               kind: 'official',
               state: 'unavailable',
               modCount: 0,
               issue: state.issue ?? 'fetch-failed'
            };
            if (state.detail) source.detail = state.detail;
            sources.push(source);
         } else {
            const selected = selectRepositoryEntries(state.cached.listing, request, 'official');
            entries.push(...selected.entries);
            fileMatches.push(...selected.fileMatches);
            sources.push({
               id: scoreSaberModSourceId,
               name: scoreSaberModSourceName,
               kind: 'official',
               state: 'ready',
               modCount: selected.entries.length
            });
         }
      }

      for (const record of records) {
         if (!record.enabled) continue;

         const blocked = describeBlock(policy, record);
         if (blocked) {
            sources.push({ id: record.id, name: record.name, kind: 'unofficial', state: 'unavailable', modCount: 0, ...blocked });
            continue;
         }

         const state = await loadListing(record, { force: false });
         if (!state.cached) {
            const source: ModSourceStatus = {
               id: record.id,
               name: record.name,
               kind: 'unofficial',
               state: 'unavailable',
               modCount: 0,
               issue: state.issue ?? 'fetch-failed'
            };
            if (state.detail) source.detail = state.detail;
            sources.push(source);
            continue;
         }

         const selected = selectRepositoryEntries(state.cached.listing, request);
         const allowed = selected.entries.filter((entry) => !isDeniedHost(policy.entries, entry.downloadHost));
         const allowedIds = new Set(allowed.map((entry) => entry.modId));
         entries.push(...allowed);
         fileMatches.push(...selected.fileMatches.filter((match) => allowedIds.has(match.modId)));
         sources.push({ id: record.id, name: record.name, kind: 'unofficial', state: 'ready', modCount: allowed.length });
      }

      return { sources, entries, fileMatches, resolution: await readSourceResolution() };
   }

   async function loadListing(record: Pick<ModRepositoryRecord, 'id' | 'listingUrl'>, input: { force: boolean }): Promise<RepositoryState> {
      await loadCache();
      const state = states.get(record.id) ?? { cached: null };
      const current = state.cached?.listingUrl === record.listingUrl ? state.cached : null;
      const fresh = current && now() - Date.parse(current.fetchedAt) < listingTtlMs;
      if (!input.force && fresh) return { cached: current };

      const fetched = await fetchRepositoryListing({
         url: record.listingUrl,
         etag: current?.etag,
         lastModified: current?.lastModified,
         fetchJson: options.fetchJson
      });

      if (Result.isError(fetched)) {
         const next: RepositoryState = { cached: current, issue: fetched.error.issue };
         if (fetched.error.detail) next.detail = fetched.error.detail;
         states.set(record.id, next);

         return next;
      }

      const fetchedAt = new Date(now()).toISOString();
      if (fetched.value.status === 'not-modified' && current) {
         return storeListing({ ...current, fetchedAt });
      }
      if (fetched.value.status === 'not-modified') {
         const next: RepositoryState = { cached: null, issue: 'fetch-failed', detail: 'the listing answered as unchanged with nothing cached' };
         states.set(record.id, next);

         return next;
      }

      if (fetched.value.listing.id !== record.id) {
         const next: RepositoryState = { cached: current, issue: 'invalid-listing', detail: 'the repository ID changed' };
         states.set(record.id, next);

         return next;
      }

      return storeListing({
         id: record.id,
         listingUrl: record.listingUrl,
         fetchedAt,
         etag: fetched.value.etag,
         lastModified: fetched.value.lastModified,
         listing: fetched.value.listing
      });
   }

   async function storeListing(cached: CachedListing): Promise<RepositoryState> {
      const next: RepositoryState = { cached };
      states.set(cached.id, next);
      await saveCache();

      return next;
   }

   async function enforcePolicy(policy: ModRepositoryPolicySnapshot, records: ModRepositoryRecord[]) {
      const blocked = records.filter((record) => record.enabled && isBlocked(policy, record));
      if (blocked.length === 0) return records;

      const next = records.map((record) => (blocked.includes(record) ? { ...record, enabled: false } : record));
      await writeRecords(next);

      return next;
   }

   function isBlocked(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord) {
      return findDenylistEntry(policy.entries, record) !== null;
   }

   function describeBlock(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord): Pick<ModSourceStatus, 'issue' | 'detail'> | null {
      if (policy.state === 'unavailable') {
         const block: Pick<ModSourceStatus, 'issue' | 'detail'> = { issue: 'policy-unavailable' };
         if (policy.detail) block.detail = policy.detail;
         return block;
      }

      const denied = findDenylistEntry(policy.entries, record);

      return denied ? { issue: 'denylisted', detail: denied.reason } : null;
   }

   async function describeSnapshot(policy: ModRepositoryPolicySnapshot, records: ModRepositoryRecord[]): Promise<ModRepositoriesSnapshot> {
      const official = await readOfficialSources();

      return {
         official: [
            { id: officialModSourceId, name: officialModSourceName, listingUrl: beatModsOrigin, enabled: official.beatModsEnabled },
            {
               id: scoreSaberModSourceId,
               name: scoreSaberModSourceName,
               listingUrl: scoreSaberModSourceUrl,
               enabled: official.scoreSaberEnabled
            }
         ],
         repositories: records.map((record) => describeRepository(policy, record)),
         resolution: await readSourceResolution()
      };
   }

   function describeRepository(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord): ModRepositorySummary {
      const denied = findDenylistEntry(policy.entries, record);
      const state = states.get(record.id);
      const listing = state?.cached?.listing ?? null;

      const summary: ModRepositorySummary = {
         id: record.id,
         name: record.name,
         owner: record.owner,
         listingUrl: record.listingUrl,
         infoUrl: record.infoUrl,
         contactUrl: record.contactUrl,
         enabled: record.enabled,
         addedAt: record.addedAt,
         blocked: denied !== null,
         blockedReason: denied?.reason ?? null,
         blockedDetailsUrl: denied?.detailsUrl ?? null,
         packageCount: listing ? listingPackageCount(listing) : null,
         checkedAt: state?.cached?.fetchedAt ?? null
      };
      if (denied) summary.issue = 'denylisted';
      else if (state?.issue) summary.issue = state.issue;
      if (state?.detail) summary.detail = state.detail;
      return summary;
   }

   async function readRecords() {
      const snapshot = await options.settingsStore.getSnapshot();
      const records = snapshot.app.modRepositories;
      const migrated = records.filter((record) => !isScoreSaberRepositoryId(record.id));
      if (migrated.length === records.length) return records;

      await writeRecords(migrated);

      return migrated;
   }

   async function readOfficialSources() {
      const snapshot = await options.settingsStore.getSnapshot();

      return {
         beatModsEnabled: snapshot.app.officialModSourceEnabled,
         scoreSaberEnabled: snapshot.app.scoreSaberModSourceEnabled
      };
   }

   async function isBeatModsEnabled() {
      return (await readOfficialSources()).beatModsEnabled;
   }

   async function readSourceResolution() {
      const snapshot = await options.settingsStore.getSnapshot();

      return snapshot.app.modSourceResolution;
   }

   async function writeRecords(records: ModRepositoryRecord[]) {
      const written = await options.settingsStore.updateAppSettings({ modRepositories: records });

      return written.ok;
   }

   async function loadCache() {
      if (cacheLoaded) return;

      cacheLoaded = true;
      const read = await readJsonFileOrDefault(cachePath, listingCacheFileSchema, {
         defaultValue: { schemaVersion: modRepositoryCacheVersion, repositories: [] }
      });
      let migrated = false;

      for (const cached of read.repositories) {
         if (!cached) continue;
         if (isScoreSaberRepositoryId(cached.id) && (cached.id !== scoreSaberModSourceId || cached.listingUrl !== scoreSaberModSourceUrl)) {
            migrated = true;
            continue;
         }

         states.set(cached.id, { cached });
      }

      if (migrated) await saveCache();
   }

   async function saveCache() {
      const repositories = [...states.values()].map((state) => state.cached).filter((cached) => cached !== null);

      await writeJsonFileAtomic(cachePath, { schemaVersion: modRepositoryCacheVersion, repositories }, listingCacheFileSchema, {
         root: options.dataPath,
         scope: 'settings'
      });
   }

   return { getSnapshot, refresh, preview, add, setEnabled, setSourceResolution, remove, sync, listEntries, isBeatModsEnabled };
}

function isScoreSaberRepositoryId(id: string) {
   return id.trim().toLowerCase() === scoreSaberModSourceId;
}

function describePreview(listing: ModRepositoryListing, listingUrl: string): ModRepositoryPreview {
   const packages = listing.packages.filter((listed) => listed !== null);
   const hosts = new Set<string>();
   const previews = packages.slice(0, modRepositoryLimits.maxPreviewPackages).map((listed) => {
      const version = listed.versions.find((candidate) => candidate !== null);
      const host = repositoryUrlHost(version?.downloadUrl ?? '');
      if (host) hosts.add(host);

      return {
         id: listed.id,
         name: listed.name,
         version: version?.version ?? '',
         downloadHost: host ?? '',
         identity: listed.identity ?? null
      };
   });

   for (const listed of packages) {
      for (const version of listed.versions) {
         const host = version ? repositoryUrlHost(version.downloadUrl) : null;
         if (host) hosts.add(host);
      }
   }

   return {
      status: 'ok',
      id: listing.id,
      name: listing.name,
      owner: listing.owner,
      listingUrl,
      infoUrl: listing.infoUrl ?? null,
      contactUrl: listing.contactUrl ?? null,
      packageCount: packages.length,
      identityClaimCount: packages.filter((listed) => listed.identity !== undefined).length,
      packages: previews,
      downloadHosts: [...hosts]
   };
}
