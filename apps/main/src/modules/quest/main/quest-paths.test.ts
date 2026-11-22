import { describe, expect, test } from 'vite-plus/test';

import {
   isQuestModFile,
   isQuestPackagePath,
   questDataKeeperPlayerDataPath,
   questModDataDir,
   questPackagePath,
   questPackagesDir,
   questRecordsPath
} from '@/modules/quest/main/quest-paths';

describe('quest paths', () => {
   test('only accepts plain files inside the game mod data and packages inside the packages folder', () => {
      expect(isQuestModFile(`${questModDataDir}/Mods/Qosmetics/Sabers/default.qsaber`)).toBe(true);
      expect(isQuestModFile('/sdcard/ModData/covers/a.png')).toBe(false);
      expect(isQuestModFile('/data/adb/evil.so')).toBe(false);
      expect(isQuestModFile(`${questModDataDir}/../../Android/evil.so`)).toBe(false);
      expect(isQuestModFile(`${questModDataDir}/Mods/SongCore`)).toBe(false);
      expect(isQuestModFile(`${questModDataDir}/Mods/cover.png/`)).toBe(false);
      expect(isQuestModFile(`${questModDataDir}/Mods/..`)).toBe(false);
      expect(isQuestModFile(questDataKeeperPlayerDataPath)).toBe(false);
      expect(isQuestModFile(questRecordsPath)).toBe(false);
      expect(isQuestPackagePath(questPackagePath('song-mod'))).toBe(true);
      expect(isQuestPackagePath(`${questPackagesDir}/1.40.8_7379/SongCore`)).toBe(true);
      expect(isQuestPackagePath(`${questPackagesDir}/1.40.8_7379`)).toBe(false);
      expect(isQuestPackagePath(`${questPackagesDir}/..`)).toBe(false);
      expect(questPackagePath('weird/../id')).toBe(`${questPackagesDir}/weird_.._id.qmod`);
   });
});
