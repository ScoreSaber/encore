import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { parseRepositoryListing, selectRepositoryEntries, type ModRepositoryVersion } from '@/modules/mods/main/repo-listing';
import { samplePackage, sampleListing, sampleVersion } from '@/modules/mods/main/repo-listing.fixture';

test('drops untrusted versions that write outside the mod folders or download without https', () => {
   const hash: ModRepositoryVersion['hash'] = { algorithm: 'sha256', value: '3'.repeat(64) };
   const unsafe: Partial<ModRepositoryVersion>[] = [
      ...['../winhttp.dll', 'IPA.exe', 'Beat Saber_Data/Managed/IPA.Injector.dll'].map((path) => ({ files: [{ path, hash }] })),
      { downloadUrl: 'http://downloads.example.com/cool-mod.zip' }
   ];

   const select = (overrides: Partial<ModRepositoryVersion>) => {
      const parsed = parseRepositoryListing(sampleListing({ packages: [samplePackage({ versions: [sampleVersion(overrides)] })] }));
      if (Result.isError(parsed)) throw new Error(parsed.error.issue);

      return selectRepositoryEntries(parsed.value, { gameVersion: '1.37.0', platform: 'steampc' }).entries;
   };

   expect(select({})).toHaveLength(1);
   for (const overrides of unsafe) {
      expect(select(overrides)).toEqual([]);
   }
});
