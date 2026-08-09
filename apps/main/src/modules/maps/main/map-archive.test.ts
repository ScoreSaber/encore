import { Result } from 'better-result';
import { unzipSync } from 'fflate';

import type { LocalMapSummary } from '@/modules/maps/contract';
import { exportMapsToZip } from '@/modules/maps/main/map-archive';

import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('map archive', () => {
   test('keeps each exported map in its own folder when two share a name', async () => {
      const first = await createFolder();
      const second = await createFolder();
      await writeMapFiles(first);
      await writeMapFiles(second);

      const destinationPath = join(await createFolder(), 'maps.zip');
      const exported = await exportMapsToZip({
         maps: [summaryOf(first, 'Same Name'), summaryOf(second, 'Same Name')],
         destinationPath
      });

      expect(Result.isOk(exported)).toBe(true);

      const entries = Object.keys(unzipSync(new Uint8Array(await readFile(destinationPath))));

      expect(entries.some((entry) => entry.startsWith('Same Name/'))).toBe(true);
      expect(entries.some((entry) => entry.startsWith('Same Name (2)/'))).toBe(true);
   });

   test('removes the partial archive when a streaming export is cancelled', async () => {
      const source = await createFolder();
      await writeMapFiles(source);
      const destinationPath = join(await createFolder(), 'maps.zip');
      const controller = new AbortController();

      const exported = await exportMapsToZip({
         maps: [summaryOf(source, 'Map')],
         destinationPath,
         signal: controller.signal,
         onProgress: () => controller.abort()
      });

      expect(Result.isError(exported)).toBe(true);
      if (Result.isError(exported)) expect(exported.error.code).toBe('maps.export.cancelled');
      expect(await exists(destinationPath)).toBe(false);
      expect(await exists(`${destinationPath}.part`)).toBe(false);
   });
});

function summaryOf(path: string, folderName: string): LocalMapSummary {
   return {
      id: folderName,
      folderName,
      path,
      hash: null,
      title: folderName,
      subTitle: '',
      artist: 'Artist',
      mappers: ['Mapper'],
      bpm: null,
      durationSeconds: null,
      difficulties: [],
      coverFileName: null,
      sizeBytes: 32,
      updatedAt: new Date(0).toISOString(),
      isDuplicate: false
   };
}

async function createFolder() {
   const path = await mkdtemp(join(tmpdir(), 'encore-map-archive-'));
   cleanups.push(async () => rm(path, { recursive: true, force: true }));

   return path;
}

async function writeMapFiles(mapPath: string) {
   const rawInfo = JSON.stringify({
      _version: '2.0.0',
      _songName: 'Staged Song',
      _songAuthorName: 'Artist',
      _levelAuthorName: 'Mapper',
      _beatsPerMinute: 160,
      _songFilename: 'song.egg',
      _difficultyBeatmapSets: [
         { _beatmapCharacteristicName: 'Standard', _difficultyBeatmaps: [{ _difficulty: 'Expert', _beatmapFilename: 'Expert.dat' }] }
      ]
   });
   const difficulty = '{"_notes":[]}';

   await writeFile(join(mapPath, 'Info.dat'), rawInfo);
   await writeFile(join(mapPath, 'Expert.dat'), difficulty);
   await writeFile(join(mapPath, 'song.egg'), 'song');
}

async function exists(path: string) {
   return Result.isOk(await Result.tryPromise({ try: () => access(path), catch: () => null }));
}
