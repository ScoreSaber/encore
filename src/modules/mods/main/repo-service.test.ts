import type { JsonDocumentFetch } from '@/lib/http/json';
import type { ModPlatform } from '@/modules/mods/contract';
import { modRepositoryPolicyUrl } from '@/modules/mods/contract';
import { samplePackage, sampleListing, samplePolicy, sampleVersion } from '@/modules/mods/main/repo-listing.fixture';
import type { ModRepositoryPolicy } from '@/modules/mods/main/repo-policy';
import { createModRepositoryService } from '@/modules/mods/main/repo-service';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const listingUrl = 'https://example.github.io/encore-repo/index.json';
const install: { gameVersion: string; platform: ModPlatform } = { gameVersion: '1.37.0', platform: 'steampc' };
const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('mod repositories', () => {
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
      expect(listed.sources).toEqual([{ id: 'com.example.repo', name: 'Example Mods', kind: 'unofficial', state: 'ready', modCount: 1 }]);
      expect(listed.entries.map((entry) => [entry.modId, entry.version, entry.downloadHost])).toEqual([
         ['com.example.repo:com.example.coolmod', '1.2.3', 'downloads.example.com']
      ]);

      expect((await harness.settingsStore.getSnapshot()).app.modRepositories).toEqual([
         expect.objectContaining({ id: 'com.example.repo', listingUrl, enabled: true })
      ]);
   });

   test('refuses a denylisted repository and switches one off that lands on the list later', async () => {
      const harness = await createHarness();
      await harness.repositories.add({ url: listingUrl, acknowledged: true });

      harness.setPolicy(samplePolicy({ version: 8, entries: [{ reason: 'malware', addedAt: '2026-07-21T00:00:00.000Z', id: 'com.example.repo' }] }));
      const refreshed = await harness.repositories.refresh();

      expect(refreshed.repositories[0]).toMatchObject({ enabled: false, blocked: true, blockedReason: 'malware', issue: 'denylisted' });
      expect(await harness.repositories.listEntries(install)).toEqual({ sources: [], entries: [], fileMatches: [] });
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
      expect(listed.sources).toEqual([{ id: 'com.example.repo', name: 'Example Mods', kind: 'unofficial', state: 'ready', modCount: 0 }]);
   });

   test('best-effort sync adds and toggles repository settings from a controller', async () => {
      const harness = await createHarness();

      const synced = await harness.repositories.sync({
         officialEnabled: false,
         repositories: [{ listingUrl, enabled: false }]
      });

      expect(synced.failures).toEqual([]);
      expect(synced.snapshot.official).toEqual([expect.objectContaining({ enabled: false })]);
      expect(synced.snapshot.repositories).toEqual([expect.objectContaining({ listingUrl, enabled: false })]);
   });
});

type HarnessOptions = {
   policy?: ModRepositoryPolicy | null;
};

async function createHarness(options: HarnessOptions = {}) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-repos-'));
   tempRoots.push(dataPath);

   let policy = 'policy' in options ? options.policy : samplePolicy();
   const listing = sampleListing({ packages: [samplePackage({ versions: [sampleVersion()] })] });
   const clock = Date.parse('2026-07-20T12:00:00.000Z');

   const fetchJson: JsonDocumentFetch = (url) => {
      const document = url === modRepositoryPolicyUrl ? policy : listing;
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
