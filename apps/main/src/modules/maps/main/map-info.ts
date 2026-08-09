import { Result } from 'better-result';
import { z } from 'zod';

import { isSafeFileName } from '@/lib/filesystem/path';
import type { MapDifficultySummary, MapProblem } from '@/modules/maps/contract';
import { createMapProblem, type MapResult } from '@/modules/maps/main/map-problem';

export type MapDifficultyInfo = MapDifficultySummary & {
   beatmapFileName: string;
   lightshowFileName: string | null;
};

export type MapInfo = {
   version: string;
   title: string;
   subTitle: string;
   artist: string;
   mappers: string[];
   bpm: number | null;
   durationSeconds: number | null;
   songFileName: string | null;
   audioDataFileName: string | null;
   coverFileName: string | null;
   difficulties: MapDifficultyInfo[];
};

const versionProbeSchema = z.object({
   version: z.string().optional(),
   _version: z.string().optional(),
   _difficultyBeatmapSets: z.unknown().optional()
});

const positiveNumberSchema = z.number().transform((value) => (value > 0 ? value : undefined));

const legacyBeatmapSchema = z.object({
   _difficulty: z.string().optional(),
   _beatmapFilename: z.string().optional()
});

const legacySetSchema = z.object({
   _beatmapCharacteristicName: z.string().optional(),
   _difficultyBeatmaps: z.array(legacyBeatmapSchema).optional()
});

const legacyInfoSchema = z.object({
   _version: z.string().optional(),
   _songName: z.string().optional(),
   _songSubName: z.string().optional(),
   _songAuthorName: z.string().optional(),
   _levelAuthorName: z.string().optional(),
   _beatsPerMinute: positiveNumberSchema.optional(),
   _songFilename: z.string().optional(),
   _coverImageFilename: z.string().optional(),
   _difficultyBeatmapSets: z.array(legacySetSchema).optional()
});

const v4BeatmapSchema = z.object({
   characteristic: z.string().optional(),
   difficulty: z.string().optional(),
   beatmapDataFilename: z.string().optional(),
   lightshowDataFilename: z.string().optional(),
   beatmapAuthors: z.object({ mappers: z.array(z.string()).optional() }).optional()
});

const v4InfoSchema = z.object({
   version: z.string(),
   song: z.object({ title: z.string().optional(), subTitle: z.string().optional(), author: z.string().optional() }).optional(),
   audio: z
      .object({
         songFilename: z.string().optional(),
         audioDataFilename: z.string().optional(),
         songDuration: positiveNumberSchema.optional(),
         bpm: positiveNumberSchema.optional()
      })
      .optional(),
   coverImageFilename: z.string().optional(),
   difficultyBeatmaps: z.array(v4BeatmapSchema).optional()
});

// map editors write Info.dat, so parse it as untrusted filesystem input at this boundary
export function parseMapInfo(raw: string, folderName?: string): MapResult<MapInfo> {
   const contents = raw.startsWith('﻿') ? raw.slice(1) : raw;
   const json = Result.try({
      try: (): unknown => JSON.parse(contents),
      catch: (cause) => createMapProblem('maps.info.invalid', 'the map description is not valid JSON', { folderName, cause })
   });
   if (Result.isError(json)) return Result.err<MapInfo, MapProblem>(json.error);

   const probe = versionProbeSchema.safeParse(json.value);
   if (!probe.success) {
      return Result.err<MapInfo, MapProblem>(createMapProblem('maps.info.invalid', 'the map description is not a map', { folderName }));
   }

   const version = probe.data.version ?? probe.data._version ?? '';
   if (version.startsWith('4')) return parseV4Info(json.value, folderName);
   if (version.startsWith('2') || version.startsWith('3') || Array.isArray(probe.data._difficultyBeatmapSets)) {
      return parseLegacyInfo(json.value, folderName);
   }

   return Result.err<MapInfo, MapProblem>(
      createMapProblem('maps.info.unsupported-version', 'this map uses a description version Encore does not read', {
         folderName,
         cause: version || 'no version'
      })
   );
}

function parseLegacyInfo(value: unknown, folderName?: string): MapResult<MapInfo> {
   const parsed = legacyInfoSchema.safeParse(value);
   if (!parsed.success) {
      return Result.err<MapInfo, MapProblem>(
         createMapProblem('maps.info.invalid', 'the map description could not be read', { folderName, cause: parsed.error.message })
      );
   }

   const info = parsed.data;
   const difficulties: MapDifficultyInfo[] = [];

   for (const set of info._difficultyBeatmapSets ?? []) {
      for (const beatmap of set._difficultyBeatmaps ?? []) {
         if (!beatmap._beatmapFilename) continue;
         if (!isSafeFileName(beatmap._beatmapFilename)) return unsafeFileName(beatmap._beatmapFilename, folderName);

         difficulties.push({
            characteristic: set._beatmapCharacteristicName ?? 'Standard',
            difficulty: beatmap._difficulty ?? 'Unknown',
            beatmapFileName: beatmap._beatmapFilename,
            lightshowFileName: null
         });
      }
   }

   const songFileName = optionalFileName(info._songFilename);
   if (songFileName === false) return unsafeFileName(info._songFilename ?? '', folderName);

   const coverFileName = optionalFileName(info._coverImageFilename);
   if (coverFileName === false) return unsafeFileName(info._coverImageFilename ?? '', folderName);

   return Result.ok<MapInfo, MapProblem>({
      version: info._version ?? '2.0.0',
      title: info._songName?.trim() ?? '',
      subTitle: info._songSubName?.trim() ?? '',
      artist: info._songAuthorName?.trim() ?? '',
      mappers: (info._levelAuthorName ?? '')
         .split(/[,&]/)
         .map((mapper) => mapper.trim())
         .filter(Boolean),
      bpm: info._beatsPerMinute ?? null,
      durationSeconds: null,
      songFileName,
      audioDataFileName: null,
      coverFileName,
      difficulties
   });
}

function parseV4Info(value: unknown, folderName?: string): MapResult<MapInfo> {
   const parsed = v4InfoSchema.safeParse(value);
   if (!parsed.success) {
      return Result.err<MapInfo, MapProblem>(
         createMapProblem('maps.info.invalid', 'the map description could not be read', { folderName, cause: parsed.error.message })
      );
   }

   const info = parsed.data;
   const difficulties: MapDifficultyInfo[] = [];
   const mappers = new Set<string>();

   for (const beatmap of info.difficultyBeatmaps ?? []) {
      for (const mapper of beatmap.beatmapAuthors?.mappers ?? []) {
         if (mapper.trim()) mappers.add(mapper.trim());
      }

      if (!beatmap.beatmapDataFilename) continue;
      if (!isSafeFileName(beatmap.beatmapDataFilename)) return unsafeFileName(beatmap.beatmapDataFilename, folderName);

      const lightshowFileName = optionalFileName(beatmap.lightshowDataFilename);
      if (lightshowFileName === false) return unsafeFileName(beatmap.lightshowDataFilename ?? '', folderName);

      difficulties.push({
         characteristic: beatmap.characteristic ?? 'Standard',
         difficulty: beatmap.difficulty ?? 'Unknown',
         beatmapFileName: beatmap.beatmapDataFilename,
         lightshowFileName
      });
   }

   const songFileName = optionalFileName(info.audio?.songFilename);
   if (songFileName === false) return unsafeFileName(info.audio?.songFilename ?? '', folderName);

   const audioDataFileName = optionalFileName(info.audio?.audioDataFilename);
   if (audioDataFileName === false) return unsafeFileName(info.audio?.audioDataFilename ?? '', folderName);

   const coverFileName = optionalFileName(info.coverImageFilename);
   if (coverFileName === false) return unsafeFileName(info.coverImageFilename ?? '', folderName);

   return Result.ok<MapInfo, MapProblem>({
      version: info.version,
      title: info.song?.title?.trim() ?? '',
      subTitle: info.song?.subTitle?.trim() ?? '',
      artist: info.song?.author?.trim() ?? '',
      mappers: [...mappers],
      bpm: info.audio?.bpm ?? null,
      durationSeconds: info.audio?.songDuration ?? null,
      songFileName,
      audioDataFileName,
      coverFileName,
      difficulties
   });
}

function unsafeFileName(name: string, folderName?: string): MapResult<MapInfo> {
   return Result.err<MapInfo, MapProblem>(
      createMapProblem('maps.info.unsafe-filename', 'the map description points at a file outside its own folder', { folderName, cause: name })
   );
}

function optionalFileName(name: string | undefined) {
   if (!name?.trim()) return null;

   return isSafeFileName(name) ? name : false;
}
