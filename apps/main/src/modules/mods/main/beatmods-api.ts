import { Result } from 'better-result';
import semver from 'semver';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import { resolveHttpsUrl } from '@/lib/http/url';
import { beatModsHost, beatModsOrigin, modCategorySchema, type ModPlatform } from '@/modules/mods/contract';

const requestTimeoutMs = 15_000;
const maxResponseBytes = 16 * 1024 * 1024;
const maxDescriptionChars = 40_000;
const apiPath = '/api/v3';
const md5Schema = z.hash('md5').transform((hash) => hash.toLowerCase());
const beatModsUrlSchema = z.string().refine((url) => Result.isOk(resolveHttpsUrl(url, { allowedHosts: [beatModsHost] })));

const platforms = {
   steampc: 'steam',
   oculuspc: 'oculus',
   universalpc: 'universal',
   quest: 'quest'
};

const categories = new Map([
   ['mod loader', 'core'],
   ['ui enhancement', 'ui'],
   ['leaderboard', 'leaderboards'],
   ['practice & training', 'practice'],
   ['streaming tools', 'streamtools'],
   ['tweaks & tools', 'tweaks'],
   ['text replacement', 'text']
]);

export type BeatModsProblem = Problem<'mods.catalog.fetch-failed' | 'mods.catalog.invalid' | 'mods.catalog.unreachable'>;

const projectSchema = z.object({
   id: z.int().positive(),
   name: z.string().trim().min(1),
   summary: z.string(),
   description: z.string().max(maxDescriptionChars).catch(''),
   category: z
      .string()
      .transform((category) => categories.get(category.trim().toLowerCase()) ?? category)
      .pipe(modCategorySchema),
   iconFileUrl: beatModsUrlSchema.nullable().catch(null),
   gitUrl: z.string().trim(),
   authors: z.array(z.object({ id: z.int().positive(), username: z.string().trim(), displayName: z.string().trim() }))
});

const versionSchema = z.object({
   projectId: z.int().positive(),
   uploaderId: z.int().positive(),
   semver: z.string().refine((version) => semver.valid(version) !== null),
   platform: z.string(),
   supportedGameVersions: z.array(z.object({ version: z.string() })),
   zipHash: md5Schema,
   downloadUrl: beatModsUrlSchema,
   dependencies: z.array(z.object({ pId: z.int().positive(), sv: z.string() })),
   contentHashes: z.array(z.object({ path: z.string().trim().min(1), hash: md5Schema })),
   fileSize: z.number().nonnegative()
});

export const beatModsEntrySchema = z
   .object({ project: projectSchema, version: versionSchema })
   .refine(({ project, version }) => project.id === version.projectId);
export type BeatModsEntry = z.infer<typeof beatModsEntrySchema>;

const beatModsListSchema = z.array(beatModsEntrySchema.nullable().catch(null));
const beatModsProjectVersionsSchema = z.object({ versions: z.array(versionSchema.nullable().catch(null)) });
const beatModsHashLookupSchema = z.record(
   md5Schema,
   z
      .object({ version: versionSchema.pick({ projectId: true, semver: true, zipHash: true, contentHashes: true }) })
      .nullable()
      .catch(null)
);

export type BeatModsApi = ReturnType<typeof createBeatModsApi>;

export function createBeatModsApi(options: { fetchJson?: JsonDocumentFetch } = {}) {
   async function listMods(input: { gameVersion: string; platform: ModPlatform }): Promise<Result<BeatModsEntry[], BeatModsProblem>> {
      const platform = platforms[input.platform];
      const compatiblePlatforms = platform === 'quest' ? [platform] : [platform, 'universal'];
      const url = new URL(`${apiPath}/mods`, beatModsOrigin);
      url.searchParams.set('status', 'verified');
      url.searchParams.set('gameName', 'beatsaber');
      url.searchParams.set('gameVersion', input.gameVersion);
      url.searchParams.set('platform', platform);

      const listed = await readJson(url, beatModsListSchema);
      if (Result.isError(listed)) {
         return listed.error.code === 'json.not-found' ? Result.ok([]) : Result.err(toBeatModsProblem(listed.error));
      }

      const compatible = await Promise.all(
         listed.value
            .filter((entry) => entry !== null)
            .map(async (entry) => {
               if (compatiblePlatforms.includes(entry.version.platform)) return Result.ok(entry);

               const detailUrl = new URL(`${apiPath}/mods/${entry.project.id}`, beatModsOrigin);
               detailUrl.searchParams.set('status', 'verified');
               const detail = await readJson(detailUrl, beatModsProjectVersionsSchema);
               return detail.map(({ versions }) => {
                  const version = versions.find(
                     (version) =>
                        version?.projectId === entry.project.id &&
                        compatiblePlatforms.includes(version.platform) &&
                        version.supportedGameVersions.some(({ version }) => version === input.gameVersion)
                  );
                  return version ? { project: entry.project, version } : null;
               });
            })
      );

      const entries = new Map<number, BeatModsEntry>();
      for (const result of compatible) {
         if (Result.isError(result)) return Result.err(toBeatModsProblem(result.error));
         if (result.value) entries.set(result.value.project.id, result.value);
      }

      for (;;) {
         const previousCount = entries.size;
         for (const [id, entry] of entries) {
            if (
               entry.version.dependencies.some(({ pId, sv }) => {
                  const dependency = entries.get(pId);
                  return !dependency || !semver.satisfies(dependency.version.semver, sv);
               })
            ) {
               entries.delete(id);
            }
         }
         if (entries.size === previousCount) return Result.ok([...entries.values()]);
      }
   }

   async function lookupHash(hash: string) {
      const parsed = md5Schema.safeParse(hash);
      if (!parsed.success) return Result.err(createProblem('mods.catalog.invalid', { detail: hash }));

      const url = new URL(`${apiPath}/hashlookup/version`, beatModsOrigin);
      url.searchParams.set('hash', parsed.data);
      url.searchParams.set('status', 'verified');

      const read = await readJson(url, beatModsHashLookupSchema);
      if (Result.isError(read)) {
         return read.error.code === 'json.not-found' ? Result.ok(null) : Result.err(toBeatModsProblem(read.error));
      }

      const releasesByArchiveHash = read.value;
      const match = Object.values(releasesByArchiveHash).find(
         (entry) => entry && (entry.version.zipHash === parsed.data || entry.version.contentHashes.some(({ hash }) => hash === parsed.data))
      );
      return Result.ok(match?.version ?? null);
   }

   function readJson<Output>(url: URL, schema: z.ZodType<Output>) {
      return fetchJsonResource({
         url: url.href,
         schema,
         maxBytes: maxResponseBytes,
         timeoutMs: requestTimeoutMs,
         fetchJson: options.fetchJson
      });
   }

   return { listMods, lookupHash };
}

function toBeatModsProblem(problem: JsonDocumentProblem): BeatModsProblem {
   const detail = { detail: problem.detail };
   if (problem.code === 'json.unreachable') return createProblem('mods.catalog.unreachable', detail);
   if (problem.code === 'json.unexpected-shape' || problem.code === 'json.invalid') return createProblem('mods.catalog.invalid', detail);
   return createProblem('mods.catalog.fetch-failed', detail);
}
