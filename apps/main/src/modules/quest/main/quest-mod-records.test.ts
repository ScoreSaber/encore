import { describe, expect, test } from 'vite-plus/test';

import { questModSourceId } from '@/modules/mods/contract';
import { buildModIndex, modIndexKey, type ModIndexEntry } from '@/modules/mods/main/mod-index';
import { summarizeMods } from '@/modules/mods/main/mod-plan';
import { describeScan, type QuestRecord } from '@/modules/quest/main/quest-mod-records';

const entry = (packageId: string, version: string, dependencies: string[] = []): ModIndexEntry => ({
   modId: modIndexKey(questModSourceId, packageId),
   packageId,
   sourceId: questModSourceId,
   sourceName: 'Quest mods',
   sourceKind: 'official',
   name: packageId,
   summary: '',
   description: '',
   iconUrl: null,
   links: [],
   category: 'library',
   author: '',
   version,
   sizeBytes: null,
   isBsipa: false,
   claimedIdentity: null,
   dependencies: dependencies.map((id) => modIndexKey(questModSourceId, id)),
   downloadUrl: `https://example.com/${packageId}.qmod`,
   downloadHost: 'example.com',
   archiveHash: null,
   files: []
});
const record = (id: string, version: string): QuestRecord => ({ id, name: id, version, modId: null, files: [], packagePath: `/packages/${id}.qmod` });

describe('Quest mod scan', () => {
   test('matches installed mods by id and lists unlisted dependencies as installed libraries', () => {
      const index = buildModIndex({
         gameVersion: '1.40.8_7379',
         platform: 'quest',
         source: 'cache',
         updatedAt: new Date().toISOString(),
         sources: [],
         entries: [entry('bsml', '0.4.55', ['tinyxml2'])]
      });

      const scan = describeScan(index, true, [record('bsml', '0.4.54'), record('tinyxml2', '10.0.0'), record('sideloaded', '1.0.0')], new Set(), []);
      const states = [...summarizeMods(index, scan), ...scan.libraries].map((mod) => [mod.name, mod.state, mod.category]);

      expect(states).toEqual([
         ['bsml', 'update-available', 'library'],
         ['tinyxml2', 'installed', 'library']
      ]);
      expect(scan.external.map((external) => external.id)).toEqual(['record:sideloaded']);
   });
});
