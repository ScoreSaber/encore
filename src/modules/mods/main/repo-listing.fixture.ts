import { modRepositoryListingSchemaVersion, modRepositoryPolicySchemaVersion } from '@/modules/mods/contract';
import type { ModRepositoryListing, ModRepositoryPackage, ModRepositoryVersion } from '@/modules/mods/main/repo-listing';
import type { ModRepositoryPolicy } from '@/modules/mods/main/repo-policy';

export function sampleListing(overrides: Partial<ModRepositoryListing> = {}): ModRepositoryListing {
   return {
      schemaVersion: modRepositoryListingSchemaVersion,
      id: 'com.example.repo',
      name: 'Example Mods',
      owner: 'Example Maintainer',
      contactUrl: 'https://github.com/example/encore-repo/issues',
      infoUrl: 'https://example.github.io/encore-repo/',
      packages: [samplePackage()],
      ...overrides
   };
}

export function samplePackage(overrides: Partial<ModRepositoryPackage> = {}): ModRepositoryPackage {
   return {
      id: 'com.example.coolmod',
      name: 'Cool Mod',
      summary: 'does something cool',
      category: 'gameplay',
      author: 'Example Maintainer',
      sourceUrl: 'https://github.com/example/cool-mod',
      issuesUrl: 'https://github.com/example/cool-mod/issues',
      versions: [sampleVersion()],
      ...overrides,
      description: overrides.description ?? ''
   };
}

export function sampleVersion(overrides: Partial<ModRepositoryVersion> = {}): ModRepositoryVersion {
   return {
      version: '1.2.3',
      gameVersions: ['1.37.0'],
      platforms: ['universalpc'],
      downloadUrl: 'https://downloads.example.com/cool-mod/1.2.3.zip',
      fileSizeBytes: 51_234,
      hash: { algorithm: 'sha256', value: '1'.repeat(64) },
      dependencies: [],
      files: [{ path: 'Plugins/CoolMod.dll', hash: { algorithm: 'sha256', value: '2'.repeat(64) } }],
      ...overrides
   };
}

export function samplePolicy(overrides: Partial<ModRepositoryPolicy> = {}): ModRepositoryPolicy {
   return {
      schemaVersion: modRepositoryPolicySchemaVersion,
      version: 7,
      updatedAt: '2026-07-20T10:00:00.000Z',
      expiresAt: '2126-07-20T10:00:00.000Z',
      entries: [],
      ...overrides
   };
}
