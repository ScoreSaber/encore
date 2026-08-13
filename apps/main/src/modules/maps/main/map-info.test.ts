import { Result } from 'better-result';
import { describe, expect, test } from 'vite-plus/test';

import { parseMapInfo } from '@/modules/maps/main/map-info';

const legacyInfo = {
   _version: '2.1.0',
   _songName: 'Test Song',
   _songSubName: 'Extended',
   _songAuthorName: 'Artist',
   _levelAuthorName: 'Mapper One & Mapper Two',
   _beatsPerMinute: 180,
   _songFilename: 'song.egg',
   _coverImageFilename: 'cover.jpg',
   _difficultyBeatmapSets: [
      {
         _beatmapCharacteristicName: 'Standard',
         _difficultyBeatmaps: [{ _difficulty: 'Expert', _beatmapFilename: 'Expert.dat' }]
      }
   ]
};

describe('map info', () => {
   test('normalizes nonpositive timing metadata while parsing', () => {
      const legacy = parseMapInfo(JSON.stringify({ ...legacyInfo, _beatsPerMinute: 0 }));
      const modern = parseMapInfo(JSON.stringify({ version: '4.0.0', audio: { bpm: -120, songDuration: 0 } }));

      expect(Result.isOk(legacy) && legacy.value.bpm).toBeNull();
      expect(Result.isOk(modern) && modern.value.bpm).toBeNull();
      expect(Result.isOk(modern) && modern.value.durationSeconds).toBeNull();
   });

   test('refuses a difficulty file name that could leave the map folder', () => {
      const parsed = parseMapInfo(
         JSON.stringify({
            ...legacyInfo,
            _difficultyBeatmapSets: [{ _difficultyBeatmaps: [{ _beatmapFilename: '../../evil.dat' }] }]
         })
      );

      expect(Result.isError(parsed)).toBe(true);
      if (Result.isOk(parsed)) return;

      expect(parsed.error.code).toBe('maps.info.unsafe-filename');
   });
});
