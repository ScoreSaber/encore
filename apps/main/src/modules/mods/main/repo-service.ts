import { Result } from 'better-result';

import type { ContentProblem } from '@/lib/content/contract';
import type { JsonDocumentFetch } from '@/lib/http/json';
import { translateProblem } from '@/lib/messages';
import { createSerialQueue } from '@/lib/state/machine';
import {
   beatModsOrigin,
   modRepositoryLimits,
   modRepositoryProblem,
   officialModSources,
   scoreSaberModSourceId,
   scoreSaberModSourceName,
   scoreSaberModSourceUrl,
   type ModPlatform,
   type ModRepositoriesSnapshot,
   type ModRepositoryAddRequest,
   type ModRepositoryIdRequest,
   type ModRepositoryIssue,
   type ModRepositoryPreview,
   type ModRepositoryRecord,
   type ModRepositoryResult,
   type ModRepositorySummary,
   type ModRepositorySyncRequest,
   type ModRepositorySyncResult,
   type ModRepositoryToggleRequest,
   type ModSourceKind,
   type ModSourceResolutionSettings,
   type ModSourceStatus
} from '@/modules/mods/contract';
import type { ModIndexEntry, ModIndexFileMatch } from '@/modules/mods/main/mod-index';
import { fetchRepositoryListing, selectRepositoryEntries, type ModRepositoryListing } from '@/modules/mods/main/repo-listing';
import { createRepositoryListingCache } from '@/modules/mods/main/repo-listing-cache';
import { createModRepositoryPolicyService, findDenylistEntry, isDeniedHost, type ModRepositoryPolicySnapshot } from '@/modules/mods/main/repo-policy';
import { repositoryUrlHost, resolveRepositoryListingUrl } from '@/modules/mods/main/repo-url';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

type ModRepositoryServiceOptions = {
   dataPath: string;
   settingsStore: SettingsStore;
   fetchJson?: JsonDocumentFetch;
   now?: () => number;
};

type ListedSource = Pick<ModRepositoryRecord, 'id' | 'name' | 'listingUrl'>;
type SourceProblem = { issue: ModRepositoryIssue; detail?: string };

const scoreSaberSource = { id: scoreSaberModSourceId, name: scoreSaberModSourceName, listingUrl: scoreSaberModSourceUrl };

export type ModRepositoryService = ReturnType<typeof createModRepositoryService>;

function syncFailure(listingUrl: string, issue: ModRepositoryIssue, detail?: string): ModRepositorySyncResult['failures'][number] {
   const failure: ModRepositorySyncResult['failures'][number] = { listingUrl, issue };
   if (detail) failure.detail = detail;
   return failure;
}

export function createModRepositoryService(options: ModRepositoryServiceOptions) {
   const now = options.now ?? Date.now;
   const policyService = createModRepositoryPolicyService({ dataPath: options.dataPath, now, fetchJson: options.fetchJson });
   const listings = createRepositoryListingCache({ dataPath: options.dataPath, now, fetchJson: options.fetchJson });
   const mutationQueue = createSerialQueue();

   async function getSnapshot(): Promise<ModRepositoriesSnapshot> {
      return describeSnapshot(await policyService.get());
   }

   async function refresh(): Promise<ModRepositoriesSnapshot> {
      const policy = await policyService.refresh();
      const records = await enforcePolicy(policy);

      if ((await readApp()).scoreSaberModSourceEnabled) await listings.load(scoreSaberSource, { force: true });

      for (const record of records) {
         if (!record.enabled || isBlocked(policy, record)) continue;

         await listings.load(record, { force: true });
      }

      return describeSnapshot(policy);
   }

   async function preview(input: { url: string }): Promise<ModRepositoryPreview> {
      const resolved = resolveRepositoryListingUrl(input.url);
      if (Result.isError(resolved)) return resolved.error;

      const fetched = await fetchRepositoryListing({ url: resolved.value, fetchJson: options.fetchJson });
      if (Result.isError(fetched)) return fetched.error;
      if (fetched.value.status !== 'ok') return modRepositoryProblem('fetch-failed', 'the listing did not answer with a document');

      const listing = fetched.value.listing;
      if (isOfficialRepositoryId(listing.id)) return modRepositoryProblem('duplicate', listing.id);

      const policy = await policyService.get();
      const denied = findDenylistEntry(policy.entries, { id: listing.id, listingUrl: resolved.value });
      if (denied) return modRepositoryProblem('denylisted', denied.reason);

      return describePreview(listing, resolved.value);
   }

   async function add(input: ModRepositoryAddRequest): Promise<ModRepositoryResult> {
      return mutationQueue.run(() => addInternal(input, true));
   }

   async function addInternal(input: ModRepositoryAddRequest, enabled: boolean): Promise<ModRepositoryResult> {
      if (!input.acknowledged) return modRepositoryProblem('not-acknowledged');

      const cachedPolicy = await policyService.get();
      const policy = cachedPolicy.state === 'ready' ? cachedPolicy : await policyService.refresh();
      if (policy.state !== 'ready') return modRepositoryProblem('policy-unavailable', policy.detail);

      const resolved = resolveRepositoryListingUrl(input.url);
      if (Result.isError(resolved)) return resolved.error;

      const listingUrl = resolved.value;
      if ((await readRecords()).some((record) => record.listingUrl === listingUrl)) return modRepositoryProblem('duplicate', listingUrl);

      const fetched = await fetchRepositoryListing({ url: listingUrl, fetchJson: options.fetchJson });
      if (Result.isError(fetched)) return fetched.error;
      if (fetched.value.status !== 'ok') return modRepositoryProblem('fetch-failed', 'the listing did not answer with a document');

      const listing = fetched.value.listing;
      if (isOfficialRepositoryId(listing.id) || (await readRecords()).some((record) => record.id === listing.id)) {
         return modRepositoryProblem('duplicate', listing.id);
      }

      const denied = findDenylistEntry(policy.entries, { id: listing.id, listingUrl });
      if (denied) return modRepositoryProblem('denylisted', denied.reason);

      const addedAt = new Date(now()).toISOString();
      const record: ModRepositoryRecord = {
         id: listing.id,
         name: listing.name,
         owner: listing.owner,
         listingUrl,
         infoUrl: listing.infoUrl ?? null,
         contactUrl: listing.contactUrl ?? null,
         enabled,
         addedAt,
         acknowledgedAt: addedAt
      };
      const written = await writeRecords((records) =>
         records.some((existing) => existing.id === record.id || existing.listingUrl === listingUrl) ? records : [...records, record]
      );
      if (!written) return modRepositoryProblem('write-failed');

      await listings.store({
         id: listing.id,
         listingUrl,
         fetchedAt: addedAt,
         etag: fetched.value.etag,
         lastModified: fetched.value.lastModified,
         listing
      });

      return { status: 'ok', snapshot: await describeSnapshot(policy) };
   }

   async function setEnabled(input: ModRepositoryToggleRequest): Promise<ModRepositoryResult> {
      return mutationQueue.run(() => setEnabledInternal(input));
   }

   async function setEnabledInternal(input: ModRepositoryToggleRequest): Promise<ModRepositoryResult> {
      const official = officialModSources.find((source) => source.id === input.id);
      if (official) {
         const written = await options.settingsStore.updateAppSettings({ [official.settingKey]: input.enabled });
         if (!written.ok) return modRepositoryProblem('write-failed');

         if (official.id === scoreSaberModSourceId && input.enabled) await listings.load(official, { force: true });

         return { status: 'ok', snapshot: await describeSnapshot(await policyService.get()) };
      }

      const record = (await readRecords()).find((candidate) => candidate.id === input.id);
      if (!record) return modRepositoryProblem('not-found', input.id);

      const policy = await policyService.get();
      if (input.enabled) {
         if (policy.state !== 'ready') return modRepositoryProblem('policy-unavailable', policy.detail);

         const denied = findDenylistEntry(policy.entries, record);
         if (denied) return modRepositoryProblem('denylisted', denied.reason);
      }

      const written = await writeRecords((records) =>
         records.map((candidate) => (candidate.id === input.id ? { ...candidate, enabled: input.enabled } : candidate))
      );
      if (!written) return modRepositoryProblem('write-failed');

      if (input.enabled) await listings.load(record, { force: true });

      return { status: 'ok', snapshot: await describeSnapshot(policy) };
   }

   async function remove(input: ModRepositoryIdRequest): Promise<ModRepositoryResult> {
      return mutationQueue.run(async () => {
         if (!(await readRecords()).some((record) => record.id === input.id)) return modRepositoryProblem('not-found', input.id);

         const written = await writeRecords((records) => records.filter((record) => record.id !== input.id));
         if (!written) return modRepositoryProblem('write-failed');

         await listings.remove(input.id);

         return { status: 'ok', snapshot: await describeSnapshot(await policyService.get()) };
      });
   }

   async function setSourceResolution(input: ModSourceResolutionSettings): Promise<ModRepositoryResult> {
      return mutationQueue.run(() => setSourceResolutionInternal(input));
   }

   async function setSourceResolutionInternal(input: ModSourceResolutionSettings): Promise<ModRepositoryResult> {
      const written = await options.settingsStore.updateAppSettings({ modSourceResolution: input });
      if (!written.ok) return modRepositoryProblem('write-failed');

      return { status: 'ok', snapshot: await getSnapshot() };
   }

   async function sync(input: ModRepositorySyncRequest): Promise<ModRepositorySyncResult> {
      return mutationQueue.run(async () => {
         const failures: ModRepositorySyncResult['failures'] = [];
         const resolution = await setSourceResolutionInternal(input.resolution);
         if (resolution.status === 'invalid') {
            failures.push(syncFailure(beatModsOrigin, resolution.issue, resolution.detail));
         }

         for (const desired of input.official) {
            const result = await setEnabledInternal(desired);
            if (result.status === 'invalid') {
               const listingUrl = officialModSources.find((source) => source.id === desired.id)?.listingUrl ?? desired.id;
               failures.push(syncFailure(listingUrl, result.issue, result.detail));
            }
         }

         for (const desired of input.repositories) {
            const existing = (await readRecords()).find((record) => record.listingUrl === desired.listingUrl);
            const result = existing
               ? existing.enabled === desired.enabled
                  ? null
                  : await setEnabledInternal({ id: existing.id, enabled: desired.enabled })
               : await addInternal({ url: desired.listingUrl, acknowledged: true }, desired.enabled);

            if (result?.status === 'invalid') {
               failures.push(syncFailure(desired.listingUrl, result.issue, result.detail));
            }
         }

         return { snapshot: await getSnapshot(), failures };
      });
   }

   async function listEntries(request: { gameVersion: string; platform: ModPlatform }) {
      const policy = await policyService.get();
      const records = await enforcePolicy(policy);
      const sources: ModSourceStatus[] = [];
      const entries: ModIndexEntry[] = [];
      const fileMatches: ModIndexFileMatch[] = [];

      const listSource = async (source: ListedSource, kind: ModSourceKind) => {
         const state = await listings.load(source, { force: false });
         if (state.cached) return state.cached.listing;

         sources.push(unavailableSource(source, kind, { issue: state.issue ?? 'fetch-failed', detail: state.detail }));
         return null;
      };

      if ((await readApp()).scoreSaberModSourceEnabled) {
         const listing = await listSource(scoreSaberSource, 'official');
         if (listing) {
            const selected = selectRepositoryEntries(listing, request, 'official');
            entries.push(...selected.entries);
            fileMatches.push(...selected.fileMatches);
            sources.push({
               id: scoreSaberSource.id,
               name: scoreSaberSource.name,
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
            sources.push(unavailableSource(record, 'unofficial', blocked));
            continue;
         }

         const listing = await listSource(record, 'unofficial');
         if (!listing) continue;

         const selected = selectRepositoryEntries(listing, request);
         const allowed = selected.entries.filter((entry) => !isDeniedHost(policy.entries, entry.downloadHost));
         const allowedIds = new Set(allowed.map((entry) => entry.modId));
         entries.push(...allowed);
         fileMatches.push(...selected.fileMatches.filter((match) => allowedIds.has(match.modId)));
         sources.push({ id: record.id, name: record.name, kind: 'unofficial', state: 'ready', modCount: allowed.length });
      }

      return { sources, entries, fileMatches, resolution: (await readApp()).modSourceResolution };
   }

   async function enforcePolicy(policy: ModRepositoryPolicySnapshot) {
      const records = await readRecords();
      if (!records.some((record) => record.enabled && isBlocked(policy, record))) return records;

      const disableBlocked = (current: ModRepositoryRecord[]) =>
         current.map((record) => (record.enabled && isBlocked(policy, record) ? { ...record, enabled: false } : record));
      await writeRecords(disableBlocked);

      return disableBlocked(records);
   }

   function isBlocked(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord) {
      return findDenylistEntry(policy.entries, record) !== null;
   }

   function describeBlock(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord): SourceProblem | null {
      if (policy.state === 'unavailable') return { issue: 'policy-unavailable', detail: policy.detail };

      const denied = findDenylistEntry(policy.entries, record);
      return denied ? { issue: 'denylisted', detail: denied.reason } : null;
   }

   async function describeSnapshot(policy: ModRepositoryPolicySnapshot): Promise<ModRepositoriesSnapshot> {
      const app = await readApp();

      return {
         official: officialModSources.map((source) => ({
            id: source.id,
            name: source.name,
            listingUrl: source.listingUrl,
            enabled: app[source.settingKey]
         })),
         repositories: await Promise.all(app.modRepositories.map((record) => describeRepository(policy, record))),
         resolution: app.modSourceResolution
      };
   }

   async function describeRepository(policy: ModRepositoryPolicySnapshot, record: ModRepositoryRecord): Promise<ModRepositorySummary> {
      const denied = findDenylistEntry(policy.entries, record);
      const state = await listings.get(record.id);
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
         packageCount: listing ? listing.packages.filter((entry) => entry !== null).length : null,
         checkedAt: state?.cached?.fetchedAt ?? null
      };
      if (denied) summary.issue = 'denylisted';
      else if (state?.issue) summary.issue = state.issue;
      if (state?.detail) summary.detail = state.detail;
      return summary;
   }

   async function readApp() {
      return (await options.settingsStore.getSnapshot()).app;
   }

   async function readRecords() {
      return (await readApp()).modRepositories;
   }

   async function writeRecords(update: (records: ModRepositoryRecord[]) => ModRepositoryRecord[]) {
      const written = await options.settingsStore.updateAppSettingsWith((current) => ({ modRepositories: update(current.modRepositories) }));

      return written.ok;
   }

   async function checkDownloadHost(host: string): Promise<Result<void, ContentProblem>> {
      const policy = await policyService.get();
      return isDeniedHost(policy.entries, host)
         ? Result.err({ code: 'content.source.unsupported-host', message: translateProblem('url.unsupported-host'), detail: host })
         : Result.ok();
   }

   return {
      getSnapshot,
      refresh,
      preview,
      add,
      setEnabled,
      setSourceResolution,
      remove,
      sync,
      listEntries,
      isBeatModsEnabled: async () => (await readApp()).officialModSourceEnabled,
      isQuestModsEnabled: async () => (await readApp()).questModSourceEnabled,
      checkDownloadHost
   };
}

function isOfficialRepositoryId(id: string) {
   const normalised = id.trim().toLowerCase();
   return officialModSources.some((source) => source.id === normalised);
}

function unavailableSource(source: ListedSource, kind: ModSourceKind, problem: SourceProblem): ModSourceStatus {
   const status: ModSourceStatus = { id: source.id, name: source.name, kind, state: 'unavailable', modCount: 0, issue: problem.issue };
   if (problem.detail) status.detail = problem.detail;
   return status;
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
