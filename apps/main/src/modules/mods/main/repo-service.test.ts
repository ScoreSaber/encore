import { expect, onTestFinished, test } from 'vite-plus/test';

import { modRepositoryPolicyUrl, scoreSaberModSourceId, scoreSaberModSourceUrl } from '@/modules/mods/contract';
import { sampleListing, samplePolicy } from '@/modules/mods/main/repo-listing.fixture';
import { createModRepositoryService } from '@/modules/mods/main/repo-service';
import { createSettingsStore } from '@/modules/settings/main/settings-store';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const listingUrl = 'https://example.github.io/encore-repo/index.json';

test('gates custom repositories on acknowledgement and the denylist', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-repos-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
   let policy = samplePolicy();
   let policyReachable = false;
   const repositories = createModRepositoryService({
      dataPath,
      settingsStore: createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' }),
      now: () => Date.parse('2026-07-20T12:00:00.000Z'),
      fetchJson: (url) => {
         if (url === modRepositoryPolicyUrl) {
            return Promise.resolve(policyReachable ? Response.json(policy) : new Response('nope', { status: 503 }));
         }

         return Promise.resolve(
            Response.json(url === scoreSaberModSourceUrl ? sampleListing({ id: scoreSaberModSourceId, packages: [] }) : sampleListing())
         );
      }
   });

   expect(await repositories.add({ url: listingUrl, acknowledged: false })).toMatchObject({ issue: 'not-acknowledged' });
   expect(await repositories.add({ url: listingUrl, acknowledged: true })).toMatchObject({ issue: 'policy-unavailable' });

   policyReachable = true;
   expect(await repositories.add({ url: listingUrl, acknowledged: true })).toMatchObject({ status: 'ok' });
   expect((await repositories.listEntries({ gameVersion: '1.37.0', platform: 'steampc' })).entries).toHaveLength(1);

   policy = samplePolicy({ version: 8, entries: [{ reason: 'malware', addedAt: '2026-07-21T00:00:00.000Z', id: 'com.example.repo' }] });
   expect((await repositories.refresh()).repositories[0]).toMatchObject({ enabled: false, blocked: true, issue: 'denylisted' });
   expect((await repositories.listEntries({ gameVersion: '1.37.0', platform: 'steampc' })).entries).toEqual([]);
   expect(await repositories.setEnabled({ id: 'com.example.repo', enabled: true })).toMatchObject({ issue: 'denylisted' });
});

test('an unreachable policy and listing host is retried after a pause, not on every read', async () => {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-repos-'));
   onTestFinished(() => rm(dataPath, { recursive: true, force: true }));
   let time = Date.parse('2026-07-20T12:00:00.000Z');
   const fetched: string[] = [];
   const repositories = createModRepositoryService({
      dataPath,
      settingsStore: createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' }),
      now: () => time,
      fetchJson: (url) => {
         fetched.push(url);
         return Promise.reject(new TypeError('fetch failed'));
      }
   });
   const listEntries = () => repositories.listEntries({ gameVersion: '1.37.0', platform: 'steampc' });

   await listEntries();
   await listEntries();
   expect(fetched).toEqual([modRepositoryPolicyUrl, scoreSaberModSourceUrl]);

   time += 6 * 60 * 1000;
   await listEntries();
   expect(fetched).toHaveLength(4);
});
