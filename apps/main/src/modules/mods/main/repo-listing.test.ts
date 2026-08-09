import { Result } from 'better-result';

import type { ModPlatform } from '@/modules/mods/contract';
import {
   fetchRepositoryListing,
   parseRepositoryListing,
   selectRepositoryEntries,
   type ModRepositoryListing,
   type ModRepositoryVersion
} from '@/modules/mods/main/repo-listing';
import { samplePackage, sampleListing, sampleVersion } from '@/modules/mods/main/repo-listing.fixture';

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const install: { gameVersion: string; platform: ModPlatform } = { gameVersion: '1.37.0', platform: 'steampc' };
const tempRoots: string[] = [];

afterEach(async () => {
   await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
   tempRoots.length = 0;
});

describe('repository listing', () => {
   test('validates each hash against its declared algorithm', () => {
      const md5 = parseRepositoryListing(
         sampleListing({ packages: [samplePackage({ versions: [sampleVersion({ hash: { algorithm: 'md5', value: ` ${'A'.repeat(32)} ` } })] })] })
      );
      const wrongLength = parseRepositoryListing(
         sampleListing({ packages: [samplePackage({ versions: [sampleVersion({ hash: { algorithm: 'md5', value: 'a'.repeat(64) } })] })] })
      );

      expect(Result.isOk(md5) && md5.value.packages[0]?.versions[0]?.hash.value).toBe('A'.repeat(32));
      expect(Result.isOk(wrongLength) && wrongLength.value.packages[0]?.versions[0]).toBeNull();
   });

   test('drops a version whose files would land outside the mod folders', () => {
      const unsafePaths = ['../winhttp.dll', 'IPA.exe', 'Beat Saber_Data/Managed/IPA.Injector.dll'];

      for (const path of unsafePaths) {
         const listing = parse(
            sampleListing({
               packages: [
                  samplePackage({
                     versions: [sampleVersion({ files: [{ path, hash: { algorithm: 'sha256', value: '3'.repeat(64) } }] })]
                  })
               ]
            })
         );

         expect(selectRepositoryEntries(listing, install).entries).toEqual([]);
      }
   });

   test('drops a version whose download is not plain https', () => {
      const listing = parse(
         sampleListing({
            packages: [samplePackage({ versions: [sampleVersion({ downloadUrl: 'http://downloads.example.com/cool-mod.zip' })] })]
         })
      );

      expect(selectRepositoryEntries(listing, install).entries).toEqual([]);
   });

   test('resolves local and BeatMods dependencies into catalogue IDs', () => {
      const listing = parse(
         sampleListing({
            packages: [samplePackage({ versions: [sampleVersion({ dependencies: ['com.example.library', 'beatmods:1'] })] })]
         })
      );

      expect(selectRepositoryEntries(listing, install).entries[0]?.dependencies).toEqual(['com.example.repo:com.example.library', 'beatmods:1']);
   });

   test('accepts only positive BeatMods package identities', () => {
      const claimed = parse(sampleListing({ packages: [samplePackage({ identity: 'beatmods:256' })] }));
      const invalid = parseRepositoryListing(sampleListing({ packages: [{ ...samplePackage(), identity: 'beatmods:0' }] }));

      expect(selectRepositoryEntries(claimed, install).entries[0]?.claimedIdentity).toBe('beatmods:256');
      expect(Result.isOk(invalid) && invalid.value.packages[0]).toBeNull();
   });

   test('keeps file matches for older compatible versions', () => {
      const oldHash: ModRepositoryVersion['hash'] = { algorithm: 'sha256', value: '3'.repeat(64) };
      const listing = parse(
         sampleListing({
            packages: [
               samplePackage({
                  versions: [
                     sampleVersion({ version: '1.2.2', files: [{ path: 'Plugins/CoolMod.dll', hash: oldHash }] }),
                     sampleVersion({ version: '1.2.3' })
                  ]
               })
            ]
         })
      );

      const selected = selectRepositoryEntries(listing, install);
      expect(selected.entries.map((entry) => entry.version)).toEqual(['1.2.3']);
      expect(selected.fileMatches).toContainEqual({
         hash: oldHash,
         modId: 'com.example.repo:com.example.coolmod',
         version: '1.2.2'
      });
   });

   test('reads a repository listing from a local file URL', async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'encore-local-repo-'));
      tempRoots.push(tempRoot);
      const listingPath = join(tempRoot, 'index.json');
      await writeFile(listingPath, JSON.stringify(sampleListing()));

      const fetched = await fetchRepositoryListing({ url: pathToFileURL(listingPath).toString() });

      expect(Result.isOk(fetched)).toBe(true);
      expect(Result.isOk(fetched) && fetched.value).toMatchObject({ status: 'ok', listing: { id: 'com.example.repo' }, etag: null });
   });

   test('reports a missing local repository listing as a fetch failure', async () => {
      const tempRoot = await mkdtemp(join(tmpdir(), 'encore-missing-repo-'));
      tempRoots.push(tempRoot);
      const fetched = await fetchRepositoryListing({ url: pathToFileURL(join(tempRoot, 'index.json')).toString() });

      expect(Result.isError(fetched) && fetched.error).toMatchObject({ issue: 'fetch-failed' });
   });
});

function parse(value: unknown): ModRepositoryListing {
   const parsed = parseRepositoryListing(value);
   if (Result.isError(parsed)) throw new Error(`the sample listing did not parse: ${parsed.error.issue}`);

   return parsed.value;
}
