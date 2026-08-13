import { describe, expect, test } from 'vite-plus/test';

import type { ModSummary } from '@/modules/mods/contract';
import { groupMods } from '@/modules/mods/renderer/grouping';

describe('mod grouping', () => {
   test('places unofficial ScoreSaber beside its BeatMods variant in leaderboards', () => {
      const groups = groupMods(
         [
            mod('beatmods:281', 'beatmods', 'BeatMods', 'official'),
            mod('beatmods:282', 'beatmods', 'BeatMods', 'official', 'BeatLeader'),
            mod('com.scoresaber.latest:scoresaber', 'com.scoresaber.latest', 'ScoreSaber Latest', 'unofficial')
         ],
         (category) => category
      );

      expect(groups).toHaveLength(1);
      expect(groups[0]?.id).toBe('category:leaderboards');
      const ids = groups.flatMap((group) => group.mods.map((entry) => entry.modId));
      expect(ids).toContain('beatmods:281');
      expect(ids).toContain('com.scoresaber.latest:scoresaber');
      expect(Math.abs(ids.indexOf('beatmods:281') - ids.indexOf('com.scoresaber.latest:scoresaber'))).toBe(1);
   });
});

function mod(modId: string, sourceId: string, sourceName: string, sourceKind: ModSummary['sourceKind'], name = 'ScoreSaber'): ModSummary {
   return {
      modId,
      sourceId,
      sourceName,
      sourceKind,
      name,
      summary: '',
      description: '',
      iconUrl: null,
      links: [],
      category: 'other',
      author: '',
      state: 'available',
      latestVersion: '3.4.1',
      installedVersion: null,
      sizeBytes: null,
      isBsipa: false,
      isRequired: false,
      dependencyIds: [],
      claimedIdentity: null
   };
}
