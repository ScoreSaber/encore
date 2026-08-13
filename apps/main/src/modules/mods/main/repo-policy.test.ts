import { afterEach, describe, expect, test } from 'vite-plus/test';

import { samplePolicy } from '@/modules/mods/main/repo-listing.fixture';
import {
   createModRepositoryPolicyService,
   findDenylistEntry,
   isDeniedHost,
   type ModRepositoryDenylistEntry,
   type ModRepositoryPolicy
} from '@/modules/mods/main/repo-policy';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('repository policy', () => {
   test('stays unavailable until ScoreSaber answers, with no bundled denylist to fall back on', async () => {
      const dataPath = await createDataPath();
      const policies = createModRepositoryPolicyService({ dataPath, fetchJson: () => Promise.reject(new Error('connect ECONNREFUSED')) });

      const policy = await policies.get();
      expect(policy.state).toBe('unavailable');
      expect(policy.version).toBeNull();
      expect(policy.entries).toEqual([]);
      expect(policy.detail).toEqual(expect.any(String));
   });

   test('keeps the copy on disk when the document goes backwards', async () => {
      const dataPath = await createDataPath();
      let document: ModRepositoryPolicy = samplePolicy({ version: 7, entries: [denylistEntry()] });
      const policies = createModRepositoryPolicyService({ dataPath, fetchJson: () => Promise.resolve(Response.json(document)) });

      expect(await policies.refresh()).toMatchObject({ state: 'ready', version: 7 });

      document = samplePolicy({ version: 5, entries: [] });
      const replayed = await policies.refresh();

      expect(replayed).toMatchObject({ state: 'ready', version: 7 });
      expect(replayed.detail).toContain('backwards');
      expect(replayed.entries).toHaveLength(1);
   });
});

describe('denylist matching', () => {
   const entries: ModRepositoryDenylistEntry[] = [
      denylistEntry({ id: 'com.example.bad', host: null, listingUrl: null }),
      denylistEntry({ id: null, host: 'bad.example', listingUrl: null }),
      denylistEntry({ id: null, host: null, listingUrl: 'https://mirror.example/index.json' })
   ];

   test('blocks repositories and downloads named by the denylist', () => {
      expect(findDenylistEntry(entries, { id: 'COM.EXAMPLE.BAD', listingUrl: 'https://fine.example/index.json' })?.reason).toBe('malware');
      expect(findDenylistEntry(entries, { id: 'com.example.other', listingUrl: 'https://bad.example/index.json' })?.reason).toBe('malware');
      expect(findDenylistEntry(entries, { id: 'com.example.other', listingUrl: 'https://mirror.example/index.json' })?.reason).toBe('malware');
      expect(findDenylistEntry(entries, { id: 'com.example.other', listingUrl: 'https://fine.example/index.json' })).toBeNull();
      expect(isDeniedHost(entries, 'BAD.example')).toBe(true);
      expect(isDeniedHost(entries, 'downloads.example.com')).toBe(false);
   });
});

async function createDataPath() {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-policy-'));
   tempRoots.push(dataPath);

   return dataPath;
}

function denylistEntry(overrides: Partial<ModRepositoryDenylistEntry> = {}): ModRepositoryDenylistEntry {
   return {
      reason: 'malware',
      addedAt: '2026-07-01T00:00:00.000Z',
      id: 'com.example.bad',
      host: 'bad.example',
      listingUrl: 'https://bad.example/index.json',
      detailsUrl: 'https://github.com/ScoreSaber/encore/issues/1',
      ...overrides
   };
}
