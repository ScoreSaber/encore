import { describe, expect, test } from 'vite-plus/test';

import type { ApiJsonValue } from '@/lib/api';
import { mergePlayerData, parsePlayerData } from '@/modules/quest/main/quest-player-data';

const level = (levelId: string, highScore: number, fullCombo: boolean) => ({
   levelId,
   difficulty: 4,
   beatmapCharacteristicName: 'Standard',
   highScore,
   maxCombo: highScore / 100,
   fullCombo,
   maxRank: 5,
   validScore: true,
   playCount: 3
});

const player = (overrides: { [key: string]: ApiJsonValue }) => ({
   playerId: 'quest-user',
   playerName: 'Umbra',
   playerSpecificSettings: { playerHeight: 1.7, leftHanded: false },
   levelsStatsData: [],
   missionsStatsData: [],
   favoritesLevelIds: [],
   playerAllOverallStatsData: { soloFreePlayOverallStatsData: { goodCutsCount: 10, timePlayed: 60 } },
   ...overrides
});

describe('Quest player data merge', () => {
   test('keeps the best stats from both, settings from incoming and the layout of base', () => {
      const vanilla = parsePlayerData(
         JSON.stringify({
            version: '2.0.35',
            localPlayers: [
               player({
                  newSetting: true,
                  levelsStatsData: [level('Crab Rave', 900_000, false)],
                  favoritesLevelIds: ['Crab Rave'],
                  playerAllOverallStatsData: { soloFreePlayOverallStatsData: { goodCutsCount: 50, timePlayed: 30 } }
               })
            ]
         })
      ).unwrap();
      const modded = parsePlayerData(
         `﻿${JSON.stringify({
            version: '2.0.28',
            localPlayers: [
               player({
                  playerSpecificSettings: { playerHeight: 1.8, leftHanded: true, removedSetting: 1 },
                  levelsStatsData: [level('Crab Rave', 800_000, true), level('custom_level_ABC', 700_000, false)],
                  favoritesLevelIds: ['custom_level_ABC']
               })
            ]
         })}`
      ).unwrap();

      const [merged] = mergePlayerData(vanilla, modded).localPlayers;
      expect(mergePlayerData(vanilla, modded).version).toBe('2.0.35');
      expect(merged).toMatchObject({
         newSetting: true,
         playerSpecificSettings: { playerHeight: 1.8, leftHanded: true },
         favoritesLevelIds: ['Crab Rave', 'custom_level_ABC'],
         playerAllOverallStatsData: { soloFreePlayOverallStatsData: { goodCutsCount: 50, timePlayed: 60 } }
      });
      expect(merged?.playerSpecificSettings).not.toHaveProperty('removedSetting');
      expect(merged?.levelsStatsData).toMatchObject([
         { levelId: 'Crab Rave', highScore: 900_000, fullCombo: true },
         { levelId: 'custom_level_ABC', highScore: 700_000 }
      ]);
   });

   test('keeps progress a partial base save has no field or mode for', () => {
      const base = parsePlayerData(
         JSON.stringify({
            localPlayers: [
               {
                  playerId: 'quest-user',
                  playerAllOverallStatsData: { soloFreePlayOverallStatsData: { goodCutsCount: 10 } }
               }
            ]
         })
      ).unwrap();
      const partialLevel = { levelId: 'Ghost', difficulty: 4, beatmapCharacteristicName: 'Standard' };
      const incoming = parsePlayerData(
         JSON.stringify({
            localPlayers: [
               player({
                  levelsStatsData: [level('Crab Rave', 900_000, true), partialLevel],
                  playerAllOverallStatsData: {
                     soloFreePlayOverallStatsData: { goodCutsCount: 5, handDistanceTravelled: 300 },
                     partyFreePlayOverallStatsData: { goodCutsCount: 7 }
                  }
               })
            ]
         })
      ).unwrap();
      const later = parsePlayerData(JSON.stringify({ localPlayers: [player({ levelsStatsData: [level('Ghost', 600_000, false)] })] })).unwrap();

      const [merged] = mergePlayerData(mergePlayerData(base, incoming), later).localPlayers;
      expect(merged?.levelsStatsData).toMatchObject([
         { levelId: 'Crab Rave', highScore: 900_000, fullCombo: true },
         { levelId: 'Ghost', highScore: 600_000, fullCombo: false }
      ]);
      expect(merged?.playerAllOverallStatsData).toEqual({
         soloFreePlayOverallStatsData: { goodCutsCount: 10, handDistanceTravelled: 300, timePlayed: 60 },
         partyFreePlayOverallStatsData: { goodCutsCount: 7 }
      });
   });
});
