import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import type { QuestConnection } from '@/modules/quest/main/quest-device-service';
import { questMergedPlayerDataPath, questSavedPlayerDataPath } from '@/modules/quest/main/quest-paths';

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';

const jsonSchema = z.json();
const jsonRecordSchema = z.record(z.string(), jsonSchema);
const scalarSchemas = [z.string(), z.number(), z.boolean()];
const settingSchema = jsonSchema.optional();
const levelStatsSchema = z.looseObject({
   levelId: z.string(),
   difficulty: jsonSchema,
   beatmapCharacteristicName: z.string(),
   highScore: z.number().optional(),
   maxCombo: z.number().optional(),
   fullCombo: z.boolean().optional(),
   maxRank: z.number().optional(),
   validScore: z.boolean().optional(),
   playCount: z.number().optional()
});
const missionStatsSchema = z.looseObject({ missionId: z.string(), cleared: z.boolean().optional() });
const overallStatsSchema = z.record(z.string(), z.record(z.string(), z.number()));
const settingsSchema = z.object({
   lastSelectedBeatmapDifficulty: settingSchema,
   lastSelectedBeatmapCharacteristicName: settingSchema,
   gameplayModifiers: settingSchema,
   playerSpecificSettings: settingSchema,
   practiceSettings: settingSchema,
   colorSchemesSettings: settingSchema,
   overrideEnvironmentSettings: settingSchema,
   multiplayerModeSettings: settingSchema
});
const localPlayerSchema = settingsSchema
   .extend({
      playerId: z.string(),
      levelsStatsData: z.array(levelStatsSchema).optional(),
      missionsStatsData: z.array(missionStatsSchema).optional(),
      showedMissionHelpIds: z.array(z.string()).optional(),
      favoritesLevelIds: z.array(z.string()).optional(),
      playerAllOverallStatsData: overallStatsSchema.optional()
   })
   .loose();
const playerDataSchema = z.looseObject({ localPlayers: z.array(localPlayerSchema) });

type PlayerData = z.infer<typeof playerDataSchema>;
type LocalPlayer = z.infer<typeof localPlayerSchema>;
type LevelStats = z.infer<typeof levelStatsSchema>;
type Json = z.infer<typeof jsonSchema>;

const settingsKeys = settingsSchema.keyof().options;

export function parsePlayerData(raw: string): Result<PlayerData, Problem> {
   return Result.try({
      try: () => playerDataSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, ''))),
      catch: (cause) => createProblem('quest.player-data.unreadable', { cause })
   });
}

export function mergePlayerData(base: PlayerData, incoming: PlayerData): PlayerData {
   const pairOnly = base.localPlayers.length === 1 && incoming.localPlayers.length === 1;
   const matched = new Set<LocalPlayer>();
   const localPlayers = base.localPlayers.map((player) => {
      const match =
         incoming.localPlayers.find((candidate) => candidate.playerId === player.playerId) ?? (pairOnly ? incoming.localPlayers[0] : undefined);
      if (!match) return player;
      matched.add(match);
      return mergePlayer(player, match);
   });
   return { ...base, localPlayers: [...localPlayers, ...incoming.localPlayers.filter((player) => !matched.has(player))] };
}

function mergePlayer(base: LocalPlayer, incoming: LocalPlayer): LocalPlayer {
   const settings = settingsKeys.flatMap((key): [string, Json][] => {
      const [from, to] = [base[key], incoming[key]];
      return from === undefined || to === undefined ? [] : [[key, overlay(from, to)]];
   });

   return {
      ...base,
      ...Object.fromEntries(settings),
      levelsStatsData: both(base.levelsStatsData, incoming.levelsStatsData, (from, to) =>
         mergeBy(from, to, (level) => JSON.stringify([level.levelId, level.difficulty, level.beatmapCharacteristicName]), bestLevel)
      ),
      missionsStatsData: both(base.missionsStatsData, incoming.missionsStatsData, (from, to) =>
         mergeBy(
            from,
            to,
            (mission) => mission.missionId,
            (left, right) => ({ ...left, cleared: both(left.cleared, right.cleared, either) })
         )
      ),
      showedMissionHelpIds: both(base.showedMissionHelpIds, incoming.showedMissionHelpIds, union),
      favoritesLevelIds: both(base.favoritesLevelIds, incoming.favoritesLevelIds, union),
      playerAllOverallStatsData: both(base.playerAllOverallStatsData, incoming.playerAllOverallStatsData, (from, to) =>
         mergeRecords(from, to, (left, right) => mergeRecords(left, right, Math.max))
      )
   };
}

function bestLevel(from: LevelStats, to: LevelStats): LevelStats {
   return {
      ...from,
      highScore: both(from.highScore, to.highScore, Math.max),
      maxCombo: both(from.maxCombo, to.maxCombo, Math.max),
      fullCombo: both(from.fullCombo, to.fullCombo, either),
      maxRank: both(from.maxRank, to.maxRank, Math.max),
      validScore: both(from.validScore, to.validScore, either),
      playCount: both(from.playCount, to.playCount, Math.max)
   };
}

function both<Value>(base: Value | undefined, incoming: Value | undefined, merge: (base: Value, incoming: Value) => Value) {
   return base === undefined || incoming === undefined ? (base ?? incoming) : merge(base, incoming);
}

function mergeBy<Entry>(base: Entry[], incoming: Entry[], key: (entry: Entry) => string, combine: (from: Entry, to: Entry) => Entry) {
   const merged = new Map(base.map((entry) => [key(entry), entry]));
   for (const entry of incoming) {
      const existing = merged.get(key(entry));
      merged.set(key(entry), existing ? combine(existing, entry) : entry);
   }
   return [...merged.values()];
}

function mergeRecords<Value>(base: Record<string, Value>, incoming: Record<string, Value>, combine: (from: Value, to: Value) => Value) {
   return Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(incoming)])].flatMap((key) => {
         const value = both(base[key], incoming[key], combine);
         return value === undefined ? [] : [[key, value]];
      })
   );
}

function either(base: boolean, incoming: boolean) {
   return base || incoming;
}

function union(base: string[], incoming: string[]) {
   return [...new Set([...base, ...incoming])];
}

function overlay(base: Json, incoming: Json): Json {
   const baseRecord = jsonRecordSchema.safeParse(base);
   const incomingRecord = jsonRecordSchema.safeParse(incoming);
   if (baseRecord.success && incomingRecord.success) {
      return Object.fromEntries(
         Object.entries(baseRecord.data).map(([key, value]) => {
            const next = incomingRecord.data[key];
            return [key, next === undefined ? value : overlay(value, next)];
         })
      );
   }
   if (Array.isArray(base) && Array.isArray(incoming)) return incoming;
   return scalarSchemas.some((schema) => schema.safeParse(base).success && schema.safeParse(incoming).success) ? incoming : base;
}

export function archiveSavedPlayerData({ client, serial }: QuestConnection) {
   return Result.gen(async function* () {
      if (!(yield* Result.await(client.fileExists(serial, questSavedPlayerDataPath)))) return Result.ok(undefined);
      yield* Result.await(client.removePath(serial, questMergedPlayerDataPath));
      return client.movePath(serial, questSavedPlayerDataPath, questMergedPlayerDataPath);
   });
}

export function foldPlayerData(connection: QuestConnection, staging: string, remotePaths: string[]) {
   const { client, serial } = connection;

   return Result.gen(async function* () {
      const pulled: string[] = [];
      for (const [index, remotePath] of remotePaths.entries()) {
         if (!(yield* Result.await(client.fileExists(serial, remotePath)))) continue;
         const localPath = join(staging, `player-data-${index}-${posix.basename(remotePath)}`);
         yield* Result.await(client.pull(serial, remotePath, localPath));
         pulled.push(localPath);
      }
      const [first, ...rest] = pulled;
      if (!first || rest.length === 0) return Result.ok(first ?? null);

      let merged = yield* parsePlayerData(yield* Result.await(readText(first)));
      for (const localPath of rest) merged = mergePlayerData(merged, yield* parsePlayerData(yield* Result.await(readText(localPath))));

      const mergedPath = join(staging, 'PlayerData.merged.dat');
      const data = merged;
      yield* Result.await(
         Result.tryPromise({
            try: () => writeFile(mergedPath, JSON.stringify(data)),
            catch: (cause) => createProblem('quest.player-data.save-failed', { cause })
         })
      );
      return Result.ok(mergedPath);
   });
}

export function publishPlayerData(connection: QuestConnection, localPath: string, remotePath: string) {
   const { client, serial } = connection;
   const staged = `${remotePath}.encore-next`;

   return Result.gen(async function* () {
      yield* Result.await(client.mkdirs(serial, posix.dirname(remotePath)));
      yield* Result.await(client.removePath(serial, staged));
      yield* Result.await(client.push(serial, localPath, staged));
      yield* Result.await(verifyCopy(connection, localPath, staged));
      yield* Result.await(client.removePath(serial, remotePath));
      return client.movePath(serial, staged, remotePath);
   });
}

export async function verifyCopy({ client, serial }: QuestConnection, localPath: string, remotePath: string): Promise<Result<void, Problem>> {
   const local = await Result.tryPromise(async () =>
      createHash('sha1')
         .update(await readFile(localPath))
         .digest('hex')
   );
   const remote = await client.sha1Files(serial, [remotePath]);
   if (Result.isOk(local) && Result.isOk(remote) && local.value === remote.value) return Result.ok(undefined);
   return Result.err(createProblem('quest.player-data.copy-failed'));
}

function readText(path: string) {
   return Result.tryPromise({
      try: () => readFile(path, 'utf8'),
      catch: (cause) => createProblem('quest.player-data.unreadable', { cause })
   });
}
