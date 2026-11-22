import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import { beatModsOrigin, modCategorySchema, type ModPlatform } from '@/modules/mods/contract';

const requestTimeoutMs = 15_000;
const maxResponseBytes = 16 * 1024 * 1024;
const maxDescriptionChars = 40_000;
const md5Schema = z.hash('md5');

type BeatModsProblemCode = 'mods.catalog.fetch-failed' | 'mods.catalog.invalid' | 'mods.catalog.unreachable';

export type BeatModsProblem = Problem<BeatModsProblemCode>;

type BeatModsResult<T> = Result<T, BeatModsProblem>;

const beatModsUserSchema = z.object({
   username: z.string().trim().min(1).optional(),
   displayName: z.string().trim().min(1).optional()
});

export const beatModsVersionSchema = z.object({
   id: z.int(),
   modId: z.int(),
   modVersion: z.string().trim().min(1),
   zipHash: z.string().trim().pipe(md5Schema),
   dependencies: z.array(z.int()).default([]),
   contentHashes: z
      .array(
         z.object({
            path: z.string().trim().min(1),
            hash: z.string().trim().pipe(md5Schema)
         })
      )
      .default([]),
   fileSize: z.number().nonnegative().optional(),
   author: beatModsUserSchema.optional()
});

export const beatModsModSchema = z.object({
   id: z.int(),
   name: z.string().trim().min(1),
   summary: z.string().default(''),
   description: z.string().max(maxDescriptionChars).catch('').default(''),
   category: modCategorySchema.default('other'),
   iconFileName: z.string().trim().default(''),
   gitUrl: z.string().trim().default(''),
   authors: z.array(beatModsUserSchema).default([])
});

const beatModsListSchema = z.object({
   mods: z.array(z.object({ mod: beatModsModSchema, latest: beatModsVersionSchema }).nullable().catch(null)).default([])
});

const beatModsHashLookupSchema = z.object({
   modVersions: z.array(beatModsVersionSchema.nullable().catch(null)).default([])
});

type BeatModsVersion = z.infer<typeof beatModsVersionSchema>;
type BeatModsMod = z.infer<typeof beatModsModSchema>;
export type BeatModsEntry = { mod: BeatModsMod; version: BeatModsVersion };

export type BeatModsApi = ReturnType<typeof createBeatModsApi>;

export function createBeatModsApi(options: { fetchJson?: JsonDocumentFetch } = {}) {
   async function checkStatus(): Promise<BeatModsResult<void>> {
      const read = await readJson(new URL('/api/status', beatModsOrigin).toString(), z.unknown());

      return Result.isError(read) ? Result.err(read.error) : Result.ok();
   }

   async function listMods(input: { gameVersion: string; platform: ModPlatform }): Promise<BeatModsResult<BeatModsEntry[]>> {
      const url = new URL('/api/mods', beatModsOrigin);
      url.searchParams.set('status', 'verified');
      url.searchParams.set('gameName', 'BeatSaber');
      url.searchParams.set('gameVersion', input.gameVersion);
      url.searchParams.set('platform', input.platform);

      const read = await readJson(url.toString(), beatModsListSchema);
      if (Result.isError(read)) return Result.err(read.error);

      const entries = read.value.mods.filter((entry) => entry !== null).map((entry) => ({ mod: entry.mod, version: entry.latest }));
      return Result.ok(entries);
   }

   async function lookupHash(hash: string): Promise<BeatModsResult<BeatModsVersion | null>> {
      if (!md5Schema.safeParse(hash).success) {
         return Result.err(createProblem('mods.catalog.invalid', { detail: hash }));
      }

      const url = new URL('/api/hashlookup', beatModsOrigin);
      url.searchParams.set('hash', hash);

      const read = await readJson(url.toString(), beatModsHashLookupSchema);
      if (Result.isError(read)) return Result.err(read.error);

      return Result.ok(read.value.modVersions.find((version) => version !== null) ?? null);
   }

   async function readJson<Output>(url: string, schema: z.ZodType<Output>) {
      const read = await fetchJsonResource({
         url,
         schema,
         maxBytes: maxResponseBytes,
         timeoutMs: requestTimeoutMs,
         fetchJson: options.fetchJson
      });

      return Result.mapError(read, toBeatModsProblem);
   }

   return { checkStatus, listMods, lookupHash };
}

function toBeatModsProblem(problem: JsonDocumentProblem): BeatModsProblem {
   const detail = { detail: problem.detail };
   if (problem.code === 'json.unreachable') return createProblem('mods.catalog.unreachable', detail);
   if (problem.code === 'json.unexpected-shape' || problem.code === 'json.invalid') return createProblem('mods.catalog.invalid', detail);
   return createProblem('mods.catalog.fetch-failed', detail);
}

export function beatModsDownloadUrl(zipHash: string) {
   return new URL(`/cdn/mod/${zipHash}.zip`, beatModsOrigin).toString();
}

export function beatModsIconUrl(iconFileName: string) {
   const name = iconFileName.trim();

   return name === '' ? null : new URL(`/cdn/icon/${encodeURIComponent(name)}`, beatModsOrigin).toString();
}

export function beatModsModUrl(modId: number) {
   return new URL(`/mods/${modId}`, beatModsOrigin).toString();
}
