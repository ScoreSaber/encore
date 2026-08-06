import type { ContentHash } from '@/lib/content/contract';
import { buildModIndex, fileHashKey, resolveModIdentities, type ModIndexEntry } from '@/modules/mods/main/mod-index';
import { summarizeMods } from '@/modules/mods/main/mod-plan';

import { describe, expect, test } from 'bun:test';

const sharedHash: ContentHash = { algorithm: 'md5', value: '1'.repeat(32) };
const previousHash: ContentHash = { algorithm: 'sha256', value: '2'.repeat(64) };

describe('mod index', () => {
   test('keeps repository identity for previous and identical BeatMods files', () => {
      const official = entry({ modId: 'beatmods:281', sourceId: 'beatmods', sourceName: 'BeatMods', version: '3.4.1', hash: sharedHash });
      const latest = entry({
         modId: 'com.scoresaber.latest:scoresaber',
         sourceId: 'com.scoresaber.latest',
         sourceName: 'ScoreSaber Latest',
         version: '3.4.2',
         hash: { algorithm: 'sha256', value: '3'.repeat(64) }
      });
      const index = buildModIndex({
         gameVersion: '1.44.1',
         platform: 'universalpc',
         source: 'remote',
         updatedAt: '2026-08-05T00:00:00.000Z',
         sources: [],
         entries: [official, latest],
         fileMatches: [
            { hash: sharedHash, modId: latest.modId, version: '3.4.1' },
            { hash: previousHash, modId: latest.modId, version: '3.4.1' }
         ]
      });

      expect(index.byFileHash.get(fileHashKey(sharedHash))).toEqual({ modId: latest.modId, version: '3.4.1' });
      const installed = index.byFileHash.get(fileHashKey(previousHash));
      expect(installed).toEqual({ modId: latest.modId, version: '3.4.1' });
      expect(index.byModId.get(latest.modId)?.version).toBe('3.4.2');

      if (!installed) throw new Error('the previous file hash was not indexed');

      const summaries = summarizeMods(index, { installed: new Map([[installed.modId, installed]]), external: [], bsipaInstalled: true });
      expect(summaries.find((mod) => mod.modId === latest.modId)).toMatchObject({
         state: 'update-available',
         installedVersion: '3.4.1',
         latestVersion: '3.4.2'
      });
   });

   test('combines claimed identities and rewrites local dependencies and file matches', () => {
      const official = entry({ modId: 'beatmods:256', sourceId: 'beatmods', sourceName: 'BeatMods', version: '1.2.3', hash: sharedHash });
      const custom = entry({
         modId: 'com.example.repo:songcore',
         sourceId: 'com.example.repo',
         sourceName: 'Example Mods',
         version: '1.3.0',
         hash: previousHash,
         claimedIdentity: 'beatmods:256'
      });
      const dependent = entry({
         modId: 'com.example.repo:dependent',
         sourceId: 'com.example.repo',
         sourceName: 'Example Mods',
         version: '1.0.0',
         hash: { algorithm: 'sha256', value: '4'.repeat(64) },
         dependencies: [custom.modId]
      });

      const resolved = resolveModIdentities(
         {
            entries: [official, custom, dependent],
            fileMatches: [{ hash: previousHash, modId: custom.modId, version: '1.2.0' }]
         },
         { combine: true, strategy: 'highest-version' }
      );

      expect(resolved.entries).toHaveLength(2);
      expect(resolved.entries.find((candidate) => candidate.modId === 'beatmods:256')).toMatchObject({
         sourceId: 'com.example.repo',
         version: '1.3.0',
         claimedIdentity: 'beatmods:256'
      });
      expect(resolved.entries.find((candidate) => candidate.packageId === dependent.packageId)?.dependencies).toEqual(['beatmods:256']);
      expect(resolved.fileMatches).toContainEqual({ hash: sharedHash, modId: 'beatmods:256', version: '1.2.3' });
      expect(resolved.fileMatches.at(-1)).toEqual({ hash: previousHash, modId: 'beatmods:256', version: '1.3.0' });
   });

   test('keeps BeatMods on a version tie unless custom repositories are preferred', () => {
      const official = entry({ modId: 'beatmods:256', sourceId: 'beatmods', sourceName: 'BeatMods', version: '2.0.0', hash: sharedHash });
      const custom = entry({
         modId: 'com.example.repo:songcore',
         sourceId: 'com.example.repo',
         sourceName: 'Example Mods',
         version: '1.0.0',
         hash: previousHash,
         claimedIdentity: 'beatmods:256'
      });

      const highest = resolveModIdentities(
         { entries: [official, { ...custom, version: '2.0.0' }], fileMatches: [] },
         {
            combine: true,
            strategy: 'highest-version'
         }
      );
      const customFirst = resolveModIdentities(
         { entries: [official, custom], fileMatches: [] },
         {
            combine: true,
            strategy: 'prefer-unofficial'
         }
      );
      const separate = resolveModIdentities({ entries: [official, custom], fileMatches: [] }, { combine: false, strategy: 'highest-version' });

      expect(highest.entries[0]?.sourceKind).toBe('official');
      expect(customFirst.entries[0]).toMatchObject({ sourceKind: 'unofficial', version: '1.0.0', modId: 'beatmods:256' });
      expect(separate.entries.map((candidate) => candidate.modId)).toEqual(['beatmods:256', 'com.example.repo:songcore']);
   });
});

function entry(input: {
   modId: string;
   sourceId: string;
   sourceName: string;
   version: string;
   hash: ContentHash;
   claimedIdentity?: string;
   dependencies?: string[];
}): ModIndexEntry {
   return {
      modId: input.modId,
      packageId: input.modId.split(':').at(-1) ?? input.modId,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceKind: input.sourceId === 'beatmods' ? 'official' : 'unofficial',
      name: 'ScoreSaber',
      summary: '',
      description: '',
      iconUrl: null,
      links: [],
      category: 'other',
      author: '',
      version: input.version,
      sizeBytes: null,
      isBsipa: false,
      claimedIdentity: input.claimedIdentity ?? null,
      dependencies: input.dependencies ?? [],
      downloadUrl: 'https://downloads.example.com/scoresaber.zip',
      downloadHost: 'downloads.example.com',
      archiveHash: input.hash,
      files: [{ path: 'Plugins/ScoreSaber.dll', hash: input.hash }]
   };
}
