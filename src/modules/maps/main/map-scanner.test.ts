import { customLevelsPath } from '@/modules/maps/main/map-paths';
import { scanCustomLevels } from '@/modules/maps/main/map-scanner';

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('map scanner', () => {
   test('hashes Info.dat together with every difficulty file it names', async () => {
      const installPath = await createInstall();
      const { rawInfo, difficulty } = await writeMap(installPath, 'hashed', 'Hashed Song');
      const expected = createHash('sha1').update(rawInfo).update(difficulty).digest('hex');

      const scanned = await scanCustomLevels({ installPath });

      expect(scanned.maps[0]?.hash).toBe(expected);
   });
});

async function createInstall() {
   const installPath = await mkdtemp(join(tmpdir(), 'encore-maps-'));
   cleanups.push(async () => rm(installPath, { recursive: true, force: true }));

   return installPath;
}

async function writeMap(installPath: string, folderName: string, title: string) {
   const mapPath = join(customLevelsPath(installPath), folderName);
   await mkdir(mapPath, { recursive: true });

   const rawInfo = JSON.stringify({
      _version: '2.0.0',
      _songName: title,
      _songAuthorName: 'Artist',
      _levelAuthorName: 'Mapper',
      _beatsPerMinute: 160,
      _songFilename: 'song.egg',
      _coverImageFilename: 'cover.jpg',
      _difficultyBeatmapSets: [
         { _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [{ _difficulty: 'Expert', _beatmapFilename: 'Expert.dat' }] }
      ]
   });
   const difficulty = '{"_notes":[]}';

   await writeFile(join(mapPath, 'Info.dat'), rawInfo);
   await writeFile(join(mapPath, 'Expert.dat'), difficulty);
   await writeFile(join(mapPath, 'cover.jpg'), 'cover');

   return { rawInfo, difficulty };
}
