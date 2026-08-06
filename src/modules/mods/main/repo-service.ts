import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFileOrDefault, writeJsonFileAtomic } from '@/lib/filesystem/json';
import type { JsonDocumentFetch } from '@/lib/http/json';
import { beatModsOrigin, officialModSourceId, officialModSourceName, type ModPlatform } from '@/modules/mods/contract';
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
const listingTtlMs = 30 * 60 * 1000;

const cachedListingSchema = z.object({
   id: z.string(),
   listingUrl: z.string(),
   fetchedAt: z.string(),
   etag: z.string().nullable().default(null),
   lastModified: z.string().nullable().default(null),
   listing: modRepositoryListingSchema
});

const listingCacheFileSchema = z.object({
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

      return describeSnapshot(policy, await readRecords(), await isOfficialEnabled());
   }

   async function refresh(): Promise<ModRepositoriesSnapshot> {
      const policy = await policyService.refresh();
      const records = await enforcePolicy(policy, await readRecords());

      for (const record of records) {
         if (!record.enabled || isBlocked(policy, record)) continue;

         await loadListing(record, { force: true });
      }

      return describeSnapshot(policy, records, await isOfficialEnabled());
   }

   async function preview(input: { url: string }): Promise<ModRepositoryPreview> {
      const resolved = resolveRepositoryListingUrl(input.url);
      if (Result.isError(resolved)) return resolved.error;

      const fetched = await fetchRepositoryListing({ url: resolved.value, fetchJson: options.fetchJson });
      if (Result.isError(fetched)) return fetched.error;
      if (fetched.value.status !== 'ok') return modRepositoryProblem('fetch-failed', 'the listing did not answer with a document');

      const listing = fetched.value.listing;
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
      if (records.some((record) => record.id === listing.id)) return modRepositoryProblem('duplicate', listing.id);

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

      return { status: 'ok', snapshot: await describeSnapshot(policy, await readRecords(), await isOfficialEnabled()) };
   }

   async function setEnabled(input: ModRepositoryToggleRequest): Promise<ModRepositoryResult> {
      if (input.id === officialModSourceId) {
         const written = await options.settingsStore.updateAppSettings({ officialModSourceEnabled: input.enabled });
         if (!written.ok) return modRepositoryProblem('write-failed');

         return { status: 'ok', snapshot: await describeSnapshot(await policyService.get(), await readRecords(), input.enabled) };
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

      if (input.enabled) await loadListing({ ...record, enabled: true }, { force: true });

      return { status: 'ok', snapshot: await describeSnapshot(policy, await readRecords(), await isOfficialEnabled()) };
   }

   async function remove(input: ModRepositoryIdRequest): Promise<ModRepositoryResult> {
      const records = await readRecords();
      if (!records.some((record) => record.id === input.id)) return modRepositoryProblem('not-found', input.id);

      const written = await writeRecords(records.filter((record) => record.id !== input.id));
      if (!written) return modRepositoryProblem('write-failed');

      states.delete(input.id);
      await saveCache();

      return { status: 'ok', snapshot: await describeSnapshot(await policyService.get(), await readRecords(), await isOfficialEnabled()) };
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
         failures.push({ listingUrl: beatModsOrigin, issue: resolution.issue, ...(resolution.detail ? { detail: resolution.detail } : {}) });
      }
      const official = await setEnabled({ id: officialModSourceId, enabled: input.officialEnabled });
      if (official.status === 'invalid')
         failures.push({ listingUrl: beatModsOrigin, issue: official.issue, ...(official.detail ? { detail: official.detail } : {}) });

      for (const desired of input.repositories) {
         const records = await readRecords();
         const existing = records.find((record) => record.listingUrl === desired.listingUrl);
         const result = existing
            ? existing.enabled === desired.enabled
               ? null
               : await setEnabled({ id: existing.id, enabled: desired.enabled })
            : await add({ url: desired.listingUrl, acknowledged: true });

         if (result?.status === 'invalid') {
            failures.push({ listingUrl: desired.listingUrl, issue: result.issue, ...(result.detail ? { detail: result.detail } : {}) });
            continue;
         }

         if (!existing && !desired.enabled) {
            const added = (await readRecords()).find((record) => record.listingUrl === desired.listingUrl);
            if (!added) continue;

            const disabled = await setEnabled({ id: added.id, enabled: false });
            if (disabled.status === 'invalid') {
               failures.push({ listingUrl: desired.listingUrl, issue: disabled.issue, ...(disabled.detail ? { detail: disabled.detail } : {}) });
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

      for (const record of records) {
         if (!record.enabled) continue;

         const blocked = describeBlock(policy, record);
         if (blocked) {
            sources.push({ id: record.id, name: record.name, kind: 'unofficial', state: 'unavailable', modCount: 0, ...blocked });
            continue;
         }

         const state = await loadListing(record, { force: false });
         if (!state.cached) {
            sources.push({
               id: record.id,
               name: record.name,
               kind: 'unofficial',
               state: 'unavailable',
               modCount: 0,
               issue: state.issue ?? 'fetch-failed',
               ...(state.detail ? { detail: state.detail } : {})
            });
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

   async function loadListing(record: ModRepositoryRecord, input: { force: boolean }): Promise<RepositoryState> {
      await loadCache();
      const state = states.get(record.id) ?? { cached: null };
      const fresh = state.cached && state.cached.listingUrl === record.listingUrl && now() - Date.parse(state.cached.fetchedAt) < listingTtlMs;
      if (!input.force && fresh) return state;

      const fetched = await fetchRepositoryListing({
         url: record.listingUrl,
         etag: state.cached?.etag,
         lastModified: state.cached?.lastModified,
         fetchJson: options.fetchJson
      });

      if (Result.isError(fetched)) {
         const next: RepositoryState = {
            cached: state.cached,
            issue: fetched.error.issue,
            ...(fetched.error.detail ? { detail: fetched.error.detail } : {})
         };
         states.set(record.id, next);

         return next;
      }

      const fetchedAt = new Date(now()).toISOString();
      if (fetched.value.status === 'not-modified' && state.cached) {
         return storeListing({ ...state.cached, listingUrl: record.listingUrl, fetchedAt });
      }
      if (fetched.value.status === 'not-modified') {
         const next: RepositoryState = { cached: null, issue: 'fetch-failed', detail: 'the listing answered as unchanged with nothing cached' };
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
         return { issue: 'policy-unavailable', ...(policy.detail ? { detail: policy.detail } : {}) };
      }

      const denied = findDenylistEntry(policy.entries, record);

      return denied ? { issue: 'denylisted', detail: denied.reason } : null;
   }

   async function describeSnapshot(
      policy: ModRepositoryPolicySnapshot,
      records: ModRepositoryRecord[],
      officialEnabled: boolean
   ): Promise<ModRepositoriesSnapshot> {
      return {
         official: [{ id: officialModSourceId, name: officialModSourceName, listingUrl: beatModsOrigin, enabled: officialEnabled }],
         repositories: records.map((record) => describeRepository(policy, record)),
         resolution: await readSourceResolution()
      };
   }

   function describeRepository(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord): ModRepositorySummary {
      const denied = findDenylistEntry(policy.entries, record);
      const state = states.get(record.id);
      const listing = state?.cached?.listing ?? null;

      return {
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
         checkedAt: state?.cached?.fetchedAt ?? null,
         ...(denied ? { issue: 'denylisted' } : state?.issue ? { issue: state.issue } : {}),
         ...(state?.detail ? { detail: state.detail } : {})
      };
   }

   async function readRecords() {
      const snapshot = await options.settingsStore.getSnapshot();

      return snapshot.app.modRepositories;
   }

   async function isOfficialEnabled() {
      const snapshot = await options.settingsStore.getSnapshot();

      return snapshot.app.officialModSourceEnabled;
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
         defaultValue: { repositories: [] }
      });

      for (const cached of read.repositories) {
         if (cached) states.set(cached.id, { cached });
      }
   }

   async function saveCache() {
      const repositories = [...states.values()].map((state) => state.cached).filter((cached) => cached !== null);

      await writeJsonFileAtomic(cachePath, { repositories }, listingCacheFileSchema, { root: options.dataPath, scope: 'settings' });
   }

   return { getSnapshot, refresh, preview, add, setEnabled, setSourceResolution, remove, sync, listEntries, isOfficialEnabled };
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
