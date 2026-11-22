import { Result } from 'better-result';
import semver from 'semver';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import { fetchQuestJson, questCoreModsUrl, type QuestCatalogFetchJson } from '@/modules/quest/main/quest-mod-catalog';

const diffIndexUrl = 'https://github.com/Lauriethefish/mbf-diffs/releases/download/1.0.0/index.json';

const gameVersionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:_\d+)?$/);
const fileNameSchema = z
   .string()
   .regex(/^[a-z\d][a-z\d._+-]*$/i)
   .refine((value) => !value.includes('..'));
const checksumSchema = z.number().int().min(0).max(0xffff_ffff);
const diffSchema = z.object({
   diff_name: fileNameSchema,
   file_name: fileNameSchema,
   file_crc: checksumSchema,
   output_file_name: fileNameSchema,
   output_crc: checksumSchema,
   output_size: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024 * 1024)
});
const versionDiffSchema = z.object({
   from_version: gameVersionSchema,
   to_version: gameVersionSchema,
   apk_diff: diffSchema,
   obb_diffs: z.array(diffSchema).min(1)
});
const diffIndexSchema = z.array(versionDiffSchema);
const coreVersionIndexSchema = z.record(gameVersionSchema, z.object({ mods: z.array(z.object({ id: z.string().min(1) })) }));

type QuestVersionDiff = z.infer<typeof versionDiffSchema>;
export type QuestVersionPlan = {
   installedVersion: string;
   version: string;
   downgrade: boolean;
   diffSequence: QuestVersionDiff[];
};
export type QuestVersionCatalog = ReturnType<typeof createQuestVersionCatalog>;

export function createQuestVersionCatalog(options: { fetchJson?: QuestCatalogFetchJson } = {}) {
   const fetchJson = options.fetchJson ?? fetchQuestJson;

   async function plan(installedVersion: string): Promise<Result<QuestVersionPlan, Problem>> {
      if (!gameVersionSchema.safeParse(installedVersion).success) {
         return Result.err(createProblem('quest.patch.invalid-version'));
      }
      const cores = await fetchJson(questCoreModsUrl);
      if (Result.isError(cores)) return Result.err(cores.error);
      const parsedCores = coreVersionIndexSchema.safeParse(cores.value);
      if (!parsedCores.success) {
         return Result.err(createProblem('quest.patch.invalid-core-index'));
      }
      const supported = new Set(
         Object.entries(parsedCores.data)
            .filter(([version, entry]) => Number(version.split('.')[1]) >= 35 && entry.mods.length > 0)
            .map(([version]) => version)
      );
      if (supported.has(installedVersion)) {
         return Result.ok({ installedVersion, version: installedVersion, downgrade: false, diffSequence: [] });
      }

      const diffs = await fetchJson(diffIndexUrl);
      if (Result.isError(diffs)) return Result.err(diffs.error);
      const parsedDiffs = diffIndexSchema.safeParse(diffs.value);
      if (!parsedDiffs.success) {
         return Result.err(createProblem('quest.patch.invalid-diff-index'));
      }

      const routes = reachableVersions(installedVersion, parsedDiffs.data);
      const candidates = [...routes.keys()].filter((version) => supported.has(version)).sort(compareVersions);
      const version = candidates[0];
      if (!version) return Result.err(createProblem('quest.patch.version-unsupported', { version: installedVersion }));
      return Result.ok({ installedVersion, version, downgrade: true, diffSequence: routes.get(version) ?? [] });
   }

   return { plan };
}

function reachableVersions(installedVersion: string, diffs: QuestVersionDiff[]) {
   const edges = new Map<string, QuestVersionDiff[]>();
   for (const diff of diffs) {
      const outgoing = edges.get(diff.from_version);
      if (outgoing) outgoing.push(diff);
      else edges.set(diff.from_version, [diff]);
   }
   const routes = new Map<string, QuestVersionDiff[]>([[installedVersion, []]]);
   const queue = [installedVersion];
   for (const version of queue) {
      for (const diff of edges.get(version) ?? []) {
         if (routes.has(diff.to_version)) continue;
         routes.set(diff.to_version, [...(routes.get(version) ?? []), diff]);
         queue.push(diff.to_version);
      }
   }
   routes.delete(installedVersion);
   return routes;
}

function compareVersions(left: string, right: string) {
   const semanticOrder = semver.rcompare(left.split('_')[0] ?? left, right.split('_')[0] ?? right);
   return semanticOrder || Number(right.split('_')[1] ?? 0) - Number(left.split('_')[1] ?? 0);
}
