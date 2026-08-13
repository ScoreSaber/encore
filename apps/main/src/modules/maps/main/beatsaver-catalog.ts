import { Result } from 'better-result';
import { z } from 'zod';

import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import { mapHashSchema, type BeatSaverListing, type BeatSaverMapSummary, type MapHash, type MapSearchIssue } from '@/modules/maps/contract';

const beatSaverApiOrigin = 'https://api.beatsaver.com';
const fetchTimeoutMs = 15_000;
const searchPageSize = 20;

const hashLookupChunkSize = 50;
const positiveNumberSchema = z.number().transform((value) => (value > 0 ? value : undefined));

export const beatSaverDownloadHosts = ['cdn.beatsaver.com', 'r2cdn.beatsaver.com', 'na.cdn.beatsaver.com', 'eu.cdn.beatsaver.com'];

export type BeatSaverMapRecord = {
   summary: BeatSaverMapSummary;
   downloadUrl: string;
   listing: BeatSaverListing;
};

export type BeatSaverProblem = {
   issue: MapSearchIssue;
   detail?: string;
};

export type BeatSaverCatalog = ReturnType<typeof createBeatSaverCatalog>;

const versionSchema = z.object({
   hash: mapHashSchema,
   downloadURL: z.string().trim().min(1),
   coverURL: z.string().trim().min(1).optional(),
   createdAt: z.string().trim().min(1).optional(),
   diffs: z.array(z.object({ characteristic: z.string().optional(), difficulty: z.string().optional() }).nullable().catch(null)).optional()
});

const documentSchema = z.object({
   id: z.string().trim().min(1),
   name: z.string().optional(),
   description: z.string().optional(),
   uploader: z.object({ name: z.string().optional() }).optional(),
   metadata: z
      .object({
         bpm: positiveNumberSchema.optional(),
         duration: positiveNumberSchema.optional(),
         songName: z.string().optional(),
         songSubName: z.string().optional(),
         songAuthorName: z.string().optional(),
         levelAuthorName: z.string().optional()
      })
      .optional(),
   stats: z.object({ upvotes: z.number().optional(), downvotes: z.number().optional() }).optional(),
   ranked: z.boolean().optional(),
   curated: z.union([z.boolean(), z.string()]).nullable().optional(),
   automapper: z.boolean().optional(),
   uploaded: z.string().optional(),
   versions: z.array(versionSchema.nullable().catch(null)).optional()
});

const searchResponseSchema = z.object({ docs: z.array(documentSchema.nullable().catch(null)) });

const hashResponseSchema = z
   .union([
      documentSchema.transform((document) => [document]),
      z.record(z.string(), documentSchema.nullable().catch(null)).transform((byHash) => Object.values(byHash).flatMap((document) => document ?? []))
   ])
   .catch([]);

type BeatSaverDocument = z.infer<typeof documentSchema>;

export function createBeatSaverCatalog(options: { fetchJson?: JsonDocumentFetch } = {}) {
   async function readJson<Output>(url: string, schema: z.ZodType<Output>, signal?: AbortSignal) {
      const read = await fetchJsonResource({ url, schema, timeoutMs: fetchTimeoutMs, signal, fetchJson: options.fetchJson });

      return Result.mapError(read, toBeatSaverProblem);
   }

   async function search(input: { query: string; page: number; signal?: AbortSignal }) {
      const url = new URL(`${beatSaverApiOrigin}/search/text/${input.page}`);
      url.searchParams.set('q', input.query);
      url.searchParams.set('sortOrder', input.query.trim() ? 'Relevance' : 'Latest');

      const fetched = await readJson(url.toString(), searchResponseSchema, input.signal);
      if (Result.isError(fetched)) return Result.err<BeatSaverMapRecord[], BeatSaverProblem>(fetched.error);

      const maps = fetched.value.docs.flatMap((document) => {
         const record = document ? toRecord(document) : null;
         return record ? [record] : [];
      });

      return Result.ok<BeatSaverMapRecord[], BeatSaverProblem>(maps);
   }

   async function getByKey(key: string, signal?: AbortSignal) {
      const fetched = await readJson(`${beatSaverApiOrigin}/maps/id/${encodeURIComponent(key)}`, documentSchema, signal);
      if (Result.isError(fetched)) return Result.err<BeatSaverMapRecord, BeatSaverProblem>(fetched.error);

      const record = toRecord(fetched.value);
      if (!record) {
         return Result.err<BeatSaverMapRecord, BeatSaverProblem>({ issue: 'invalid-response', detail: 'the map has no downloadable version' });
      }

      return Result.ok<BeatSaverMapRecord, BeatSaverProblem>(record);
   }

   async function getByHashes(hashes: readonly string[], signal?: AbortSignal) {
      const wanted = [
         ...new Set(
            hashes.flatMap((hash) => {
               const parsed = mapHashSchema.safeParse(hash);
               return parsed.success ? [parsed.data] : [];
            })
         )
      ];
      const records = new Map<MapHash, BeatSaverMapRecord>();

      for (let index = 0; index < wanted.length; index += hashLookupChunkSize) {
         const chunk = wanted.slice(index, index + hashLookupChunkSize);
         const fetched = await readJson(`${beatSaverApiOrigin}/maps/hash/${chunk.join(',')}`, hashResponseSchema, signal);
         if (Result.isError(fetched)) return Result.err<Map<MapHash, BeatSaverMapRecord>, BeatSaverProblem>(fetched.error);

         for (const document of fetched.value) {
            for (const hash of chunk) {
               const record = toRecord(document, hash);
               if (record) records.set(record.summary.hash, record);
            }
         }
      }

      return Result.ok<Map<MapHash, BeatSaverMapRecord>, BeatSaverProblem>(records);
   }

   return { search, getByKey, getByHashes, pageSize: searchPageSize };
}

function toBeatSaverProblem(problem: JsonDocumentProblem): BeatSaverProblem {
   const failed = problem.code === 'json.unreachable' || problem.code === 'json.fetch-failed' || problem.code === 'json.not-found';

   const catalogProblem: BeatSaverProblem = { issue: failed ? 'fetch-failed' : 'invalid-response' };
   if (problem.detail) catalogProblem.detail = problem.detail;
   return catalogProblem;
}

function toRecord(document: BeatSaverDocument, hash?: string): BeatSaverMapRecord | null {
   const version = document.versions?.find((entry) => entry !== null && (!hash || entry.hash === hash));
   if (!version) return null;

   const metadata = document.metadata;
   const difficulties = (version.diffs ?? []).flatMap((diff) =>
      diff ? [{ characteristic: diff.characteristic ?? 'Standard', difficulty: diff.difficulty ?? 'Unknown' }] : []
   );

   const summary: BeatSaverMapSummary = {
      key: document.id,
      hash: version.hash,
      title: metadata?.songName?.trim() || document.name?.trim() || document.id,
      subTitle: metadata?.songSubName?.trim() ?? '',
      artist: metadata?.songAuthorName?.trim() ?? '',
      mapper: document.uploader?.name?.trim() || (metadata?.levelAuthorName?.trim() ?? ''),
      bpm: metadata?.bpm ?? null,
      durationSeconds: metadata?.duration ?? null,
      upvotes: document.stats?.upvotes ?? 0,
      downvotes: document.stats?.downvotes ?? 0,
      ranked: document.ranked ?? false,
      curated: Boolean(document.curated),
      automapper: document.automapper ?? false,
      publishedAt: document.uploaded ?? version.createdAt ?? null,
      difficulties,
      coverUrl: version.coverURL ?? null,
      installed: false
   };

   return {
      summary,
      downloadUrl: version.downloadURL,
      listing: {
         url: `https://beatsaver.com/maps/${encodeURIComponent(document.id)}`,
         description: document.description?.trim() ?? ''
      }
   };
}
