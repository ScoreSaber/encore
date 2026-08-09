import type { JsonDocumentFetch } from '@/lib/http/json';
import type { ModPlatform, ModSourceStatus } from '@/modules/mods/contract';
import {
   modRepositoryPolicyUrl,
   officialModSourceId,
   scoreSaberModSourceId,
   scoreSaberModSourceName,
   scoreSaberModSourceUrl
} from '@/modules/mods/contract';
import type { ModRepositoryListing } from '@/modules/mods/main/repo-listing';
import { samplePackage, sampleListing, samplePolicy, sampleVersion } from '@/modules/mods/main/repo-listing.fixture';
import type { ModRepositoryPolicy } from '@/modules/mods/main/repo-policy';
import { createModRepositoryService } from '@/modules/mods/main/repo-service';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const listingUrl = 'https://example.github.io/encore-repo/index.json';
const install: { gameVersion: string; platform: ModPlatform } = { gameVersion: '1.37.0', platform: 'steampc' };
const tempRoots: string[] = [];
const emptyScoreSaberSource: ModSourceStatus = {
   id: scoreSaberModSourceId,
   name: scoreSaberModSourceName,
   kind: 'official',
   state: 'ready',
   modCount: 0
};

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('mod repositories', () => {
   test('lists ScoreSaber as an enabled official source and reads its repository schema', async () => {
      const harness = await createHarness({
         officialListing: sampleListing({
            id: scoreSaberModSourceId,
            name: scoreSaberModSourceName,
            owner: 'ScoreSaber',
            packages: [samplePackage({ id: 'scoresaber', name: 'ScoreSaber', identity: 'beatmods:281' })]
         })
      });

      expect((await harness.repositories.getSnapshot()).official).toEqual([
         { id: officialModSourceId, name: 'BeatMods', listingUrl: 'https://beatmods.com', enabled: true },
         { id: scoreSaberModSourceId, name: scoreSaberModSourceName, listingUrl: scoreSaberModSourceUrl, enabled: true }
      ]);

      const listed = await harness.repositories.listEntries(install);
      expect(listed.sources).toEqual([{ id: scoreSaberModSourceId, name: scoreSaberModSourceName, kind: 'official', state: 'ready', modCount: 1 }]);
      expect(listed.entries[0]).toMatchObject({
         modId: `${scoreSaberModSourceId}:scoresaber`,
         sourceId: scoreSaberModSourceId,
         sourceKind: 'official'
      });
   });

   test('removes every custom repository using the ScoreSaber source ID', async () => {
      const harness = await createHarness();
      const legacyUrl = 'https://raw.githubusercontent.com/ScoreSaber/pc-mod/refs/heads/main/index.json';
      await harness.settingsStore.updateAppSettings({
         modRepositories: [
            {
               id: scoreSaberModSourceId,
               name: 'ScoreSaber Latest',
               owner: 'ScoreSaber',
               listingUrl: legacyUrl,
               infoUrl: null,
               contactUrl: null,
               enabled: true,
               addedAt: '2026-08-01T00:00:00.000Z',
               acknowledgedAt: '2026-08-01T00:00:00.000Z'
            }
         ]
      });
      await writeFile(
         join(harness.dataPath, 'mod-repositories.json'),
         JSON.stringify({
            schemaVersion: 1,
            repositories: [
               {
                  id: scoreSaberModSourceId,
                  listingUrl: legacyUrl,
                  fetchedAt: '2026-08-01T00:00:00.000Z',
                  etag: null,
                  lastModified: null,
                  listing: sampleListing({ id: scoreSaberModSourceId, name: 'ScoreSaber Latest', owner: 'ScoreSaber' })
               }
            ]
         }),
         'utf8'
      );

      expect((await harness.repositories.getSnapshot()).repositories).toEqual([]);
      expect((await harness.settingsStore.getSnapshot()).app.modRepositories).toEqual([]);
      expect(JSON.parse(await readFile(join(harness.dataPath, 'mod-repositories.json'), 'utf8')).repositories).toEqual([]);
   });

   test('does not add another custom copy of the official ScoreSaber source', async () => {
      const harness = await createHarness({
         listing: sampleListing({ id: scoreSaberModSourceId, name: 'ScoreSaber mirror', owner: 'Someone else' })
      });

      expect(await harness.repositories.preview({ url: listingUrl })).toMatchObject({ status: 'invalid', issue: 'duplicate' });
      expect(await harness.repositories.add({ url: listingUrl, acknowledged: true })).toMatchObject({ status: 'invalid', issue: 'duplicate' });
      expect((await harness.settingsStore.getSnapshot()).app.modRepositories).toEqual([]);
   });

   test('refuses to add anything until the risk is acknowledged and the denylist is known', async () => {
      const harness = await createHarness({ policy: null });

      expect(await harness.repositories.add({ url: listingUrl, acknowledged: false })).toMatchObject({ issue: 'not-acknowledged' });
      expect(await harness.repositories.add({ url: listingUrl, acknowledged: true })).toMatchObject({ issue: 'policy-unavailable' });
      expect((await harness.repositories.getSnapshot()).repositories).toEqual([]);
   });

   test('adds an acknowledged repository and merges its mods into the index', async () => {
      const harness = await createHarness();

      const added = await harness.repositories.add({ url: listingUrl, acknowledged: true });
      expect(added).toMatchObject({ status: 'ok' });
      if (added.status !== 'ok') return;

      expect(added.snapshot.repositories).toEqual([
         expect.objectContaining({ id: 'com.example.repo', name: 'Example Mods', enabled: true, blocked: false, packageCount: 1 })
      ]);

      const listed = await harness.repositories.listEntries(install);
      expect(listed.sources).toEqual([
         emptyScoreSaberSource,
         { id: 'com.example.repo', name: 'Example Mods', kind: 'unofficial', state: 'ready', modCount: 1 }
      ]);
      expect(listed.entries.map((entry) => [entry.modId, entry.version, entry.downloadHost])).toEqual([
         ['com.example.repo:com.example.coolmod', '1.2.3', 'downloads.example.com']
      ]);

      expect((await harness.settingsStore.getSnapshot()).app.modRepositories).toEqual([
         expect.objectContaining({ id: 'com.example.repo', listingUrl, enabled: true })
      ]);
   });

   test('reports BeatMods identity claims while reviewing a repository', async () => {
      const harness = await createHarness({ listing: sampleListing({ packages: [samplePackage({ identity: 'beatmods:256' })] }) });

      expect(await harness.repositories.preview({ url: listingUrl })).toMatchObject({
         status: 'ok',
         identityClaimCount: 1,
         packages: [expect.objectContaining({ identity: 'beatmods:256' })]
      });
   });

   test('refuses a denylisted repository and switches one off that lands on the list later', async () => {
      const harness = await createHarness();
      await harness.repositories.add({ url: listingUrl, acknowledged: true });

      harness.setPolicy(samplePolicy({ version: 8, entries: [{ reason: 'malware', addedAt: '2026-07-21T00:00:00.000Z', id: 'com.example.repo' }] }));
      const refreshed = await harness.repositories.refresh();

      expect(refreshed.repositories[0]).toMatchObject({ enabled: false, blocked: true, blockedReason: 'malware', issue: 'denylisted' });
      expect(await harness.repositories.listEntries(install)).toEqual({
         sources: [emptyScoreSaberSource],
         entries: [],
         fileMatches: [],
         resolution: { combine: true, strategy: 'highest-version' }
      });
      expect(await harness.repositories.setEnabled({ id: 'com.example.repo', enabled: true })).toMatchObject({ issue: 'denylisted' });
      expect(await harness.repositories.add({ url: listingUrl, acknowledged: true })).toMatchObject({ issue: 'duplicate' });
   });

   test('drops the mods of a denylisted download host without dropping the repository', async () => {
      const harness = await createHarness();
      await harness.repositories.add({ url: listingUrl, acknowledged: true });

      harness.setPolicy(
         samplePolicy({ version: 9, entries: [{ reason: 'malware', addedAt: '2026-07-21T00:00:00.000Z', host: 'downloads.example.com' }] })
      );
      await harness.repositories.refresh();

      const listed = await harness.repositories.listEntries(install);
      expect(listed.entries).toEqual([]);
      expect(listed.sources).toEqual([
         emptyScoreSaberSource,
         { id: 'com.example.repo', name: 'Example Mods', kind: 'unofficial', state: 'ready', modCount: 0 }
      ]);
   });

   test('best-effort sync adds and toggles repository settings from a controller', async () => {
      const harness = await createHarness();

      const synced = await harness.repositories.sync({
         official: [
            { id: officialModSourceId, enabled: false },
            { id: scoreSaberModSourceId, enabled: true }
         ],
         repositories: [{ listingUrl, enabled: false }],
         resolution: { combine: true, strategy: 'prefer-unofficial' }
      });

      expect(synced.failures).toEqual([]);
      expect(synced.snapshot.official).toEqual([
         expect.objectContaining({ id: officialModSourceId, enabled: false }),
         expect.objectContaining({ id: scoreSaberModSourceId, enabled: true })
      ]);
      expect(synced.snapshot.repositories).toEqual([expect.objectContaining({ listingUrl, enabled: false })]);
      expect(synced.snapshot.resolution).toEqual({ combine: true, strategy: 'prefer-unofficial' });
   });
});

type HarnessOptions = {
   policy?: ModRepositoryPolicy | null;
   listing?: ModRepositoryListing;
   officialListing?: ModRepositoryListing;
};

async function createHarness(options: HarnessOptions = {}) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-repos-'));
   tempRoots.push(dataPath);

   let policy = 'policy' in options ? options.policy : samplePolicy();
   const listing = options.listing ?? sampleListing({ packages: [samplePackage({ versions: [sampleVersion()] })] });
   const officialListing =
      options.officialListing ?? sampleListing({ id: scoreSaberModSourceId, name: scoreSaberModSourceName, owner: 'ScoreSaber', packages: [] });
   const clock = Date.parse('2026-07-20T12:00:00.000Z');

   const fetchJson: JsonDocumentFetch = (url) => {
      const document = url === modRepositoryPolicyUrl ? policy : url === scoreSaberModSourceUrl ? officialListing : listing;
      if (document === null) return Promise.resolve(new Response('nope', { status: 503 }));

      return Promise.resolve(Response.json(document));
   };

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   const repositories = createModRepositoryService({ dataPath, settingsStore, fetchJson, now: () => clock });

   return {
      dataPath,
      settingsStore,
      repositories,
      setPolicy: (next: ModRepositoryPolicy | null) => {
         policy = next;
      }
   };
}
