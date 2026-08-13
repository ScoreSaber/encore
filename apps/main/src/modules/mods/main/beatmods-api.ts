import { Result } from 'better-result';
import { z } from 'zod';

import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import { beatModsOrigin, modCategorySchema, type ModPlatform } from '@/modules/mods/contract';

const requestTimeoutMs = 15_000;
const maxResponseBytes = 16 * 1024 * 1024;
const maxDescriptionChars = 40_000;
const md5Schema = z.hash('md5');

export type BeatModsProblemCode = 'mods.catalog.fetch-failed' | 'mods.catalog.invalid' | 'mods.catalog.unreachable';

export type BeatModsProblem = {
   code: BeatModsProblemCode;
   message: string;
   detail?: string;
};

export type BeatModsResult<T> = Result<T, BeatModsProblem>;

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

export type BeatModsVersion = z.infer<typeof beatModsVersionSchema>;
export type BeatModsMod = z.infer<typeof beatModsModSchema>;
export type BeatModsEntry = { mod: BeatModsMod; version: BeatModsVersion };

export type BeatModsApiOptions = {
   origin?: string;
   fetchJson?: JsonDocumentFetch;
};

export type BeatModsApi = ReturnType<typeof createBeatModsApi>;

export function createBeatModsApi(options: BeatModsApiOptions = {}) {
   const origin = options.origin ?? beatModsOrigin;

   async function checkStatus(): Promise<BeatModsResult<void>> {
      const read = await readJson(new URL('/api/status', origin).toString(), z.unknown());

      return Result.isError(read) ? Result.err<void, BeatModsProblem>(read.error) : Result.ok<void, BeatModsProblem>(undefined);
   }

   async function listMods(input: { gameVersion: string; platform: ModPlatform }): Promise<BeatModsResult<BeatModsEntry[]>> {
      const url = new URL('/api/mods', origin);
      url.searchParams.set('status', 'verified');
      url.searchParams.set('gameName', 'BeatSaber');
      url.searchParams.set('gameVersion', input.gameVersion);
      url.searchParams.set('platform', input.platform);

      const read = await readJson(url.toString(), beatModsListSchema, 'the BeatMods list could not be read');
      if (Result.isError(read)) return Result.err<BeatModsEntry[], BeatModsProblem>(read.error);

      const entries = read.value.mods.filter((entry) => entry !== null).map((entry) => ({ mod: entry.mod, version: entry.latest }));
      return Result.ok<BeatModsEntry[], BeatModsProblem>(entries);
   }

   async function lookupHash(hash: string): Promise<BeatModsResult<BeatModsVersion | null>> {
      if (!md5Schema.safeParse(hash).success) {
         return Result.err<BeatModsVersion | null, BeatModsProblem>({ code: 'mods.catalog.invalid', message: 'the file hash is not an md5 digest' });
      }

      const url = new URL('/api/hashlookup', origin);
      url.searchParams.set('hash', hash);

      const read = await readJson(url.toString(), beatModsHashLookupSchema, 'the BeatMods hash lookup could not be read');
      if (Result.isError(read)) return Result.err<BeatModsVersion | null, BeatModsProblem>(read.error);

      return Result.ok<BeatModsVersion | null, BeatModsProblem>(read.value.modVersions.find((version) => version !== null) ?? null);
   }

   async function readJson<Output>(url: string, schema: z.ZodType<Output>, invalidResponseMessage = 'the BeatMods answer could not be read') {
      const read = await fetchJsonResource({
         url,
         schema,
         maxBytes: maxResponseBytes,
         timeoutMs: requestTimeoutMs,
         fetchJson: options.fetchJson
      });

      return Result.mapError(read, (problem) => toBeatModsProblem(problem, invalidResponseMessage));
   }

   return { checkStatus, listMods, lookupHash };
}

function toBeatModsProblem(problem: JsonDocumentProblem, invalidResponseMessage: string): BeatModsProblem {
   const detail = problem.detail ? { detail: problem.detail } : {};

   if (problem.code === 'json.unreachable') return { code: 'mods.catalog.unreachable', message: 'BeatMods could not be reached', ...detail };
   if (problem.code === 'json.unexpected-shape') return { code: 'mods.catalog.invalid', message: invalidResponseMessage, ...detail };
   if (problem.code === 'json.invalid') return { code: 'mods.catalog.invalid', message: 'the BeatMods answer could not be read', ...detail };
   if (problem.code === 'json.too-large') return { code: 'mods.catalog.fetch-failed', message: 'the BeatMods answer could not be read', ...detail };

   return { code: 'mods.catalog.fetch-failed', message: 'BeatMods answered with an error', ...detail };
}

export function beatModsDownloadUrl(zipHash: string, origin = beatModsOrigin) {
   return new URL(`/cdn/mod/${zipHash}.zip`, origin).toString();
}

export function beatModsIconUrl(iconFileName: string, origin = beatModsOrigin) {
   const name = iconFileName.trim();

   return name === '' ? null : new URL(`/cdn/icon/${encodeURIComponent(name)}`, origin).toString();
}

export function beatModsModUrl(modId: number, origin = beatModsOrigin) {
   return new URL(`/mods/${modId}`, origin).toString();
}
