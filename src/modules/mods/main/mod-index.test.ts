import type { ContentHash } from '@/lib/content/contract';
import { buildModIndex, fileHashKey, type ModIndexEntry } from '@/modules/mods/main/mod-index';
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
});

function entry(input: { modId: string; sourceId: string; sourceName: string; version: string; hash: ContentHash }): ModIndexEntry {
   return {
      modId: input.modId,
      packageId: 'scoresaber',
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
      dependencies: [],
      downloadUrl: 'https://downloads.example.com/scoresaber.zip',
      downloadHost: 'downloads.example.com',
      archiveHash: input.hash,
      files: [{ path: 'Plugins/ScoreSaber.dll', hash: input.hash }]
   };
}
