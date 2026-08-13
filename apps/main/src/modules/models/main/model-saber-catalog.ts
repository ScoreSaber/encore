import { Result } from 'better-result';
import { z } from 'zod';

import { fetchJsonResource, type JsonDocumentFetch, type JsonDocumentProblem } from '@/lib/http/json';
import { modelTypeSchema, type ModelSaberModelSummary, type ModelSearchIssue, type ModelType } from '@/modules/models/contract';

const modelSaberApiOrigin = 'https://modelsaber.com/api/v2/';
const getEndpoint = 'get.php';
const fetchTimeoutMs = 15_000;
const searchPageSize = 20;

export const modelSaberDownloadHosts = ['modelsaber.com', 'www.modelsaber.com', 'cdn.modelsaber.com'];

export type ModelSaberRecord = {
   summary: ModelSaberModelSummary;
   downloadUrl: string;
};

export type ModelSaberProblem = {
   issue: ModelSearchIssue;
   detail?: string;
};

export type ModelSaberCatalog = ReturnType<typeof createModelSaberCatalog>;

const documentSchema = z.object({
   id: z.union([z.number(), z.string()]),
   type: z.string().optional(),
   name: z.string().optional(),
   author: z.string().optional(),
   thumbnail: z.string().optional(),
   hash: z.string().optional(),
   download: z.string().optional(),
   date: z.string().optional(),
   tags: z.array(z.string()).optional()
});

const responseSchema = z.union([
   z.array(documentSchema.nullable().catch(null)).transform((documents) => documents.flatMap((document) => document ?? [])),
   z.record(z.string(), documentSchema.nullable().catch(null)).transform((byId) => Object.values(byId).flatMap((document) => document ?? []))
]);

type ModelSaberDocument = z.infer<typeof documentSchema>;

export function createModelSaberCatalog(options: { fetchJson?: JsonDocumentFetch } = {}) {
   async function readJson(url: string, signal?: AbortSignal) {
      const read = await fetchJsonResource({ url, schema: responseSchema, timeoutMs: fetchTimeoutMs, signal, fetchJson: options.fetchJson });

      return Result.mapError(read, toModelSaberProblem);
   }

   async function search(input: { type: ModelType; query: string; page: number; signal?: AbortSignal }) {
      const start = input.page * searchPageSize;
      const query: CatalogQuery = {
         type: input.type,
         start,
         end: start + searchPageSize,
         sort: 'date',
         sortDirection: 'desc'
      };
      if (input.query.trim()) query.filter = input.query.trim();
      const url = buildUrl(query);

      const fetched = await readJson(url, input.signal);
      if (Result.isError(fetched)) return Result.err<ModelSaberRecord[], ModelSaberProblem>(fetched.error);

      const records = fetched.value.flatMap((document) => {
         const record = toRecord(document);
         return record && record.summary.type === input.type ? [record] : [];
      });

      return Result.ok<ModelSaberRecord[], ModelSaberProblem>(records);
   }

   async function getById(id: string, signal?: AbortSignal) {
      return fetchOne(buildUrl({ start: 0, end: 1, filter: `id:${id}` }), signal);
   }

   async function getByHash(hash: string, signal?: AbortSignal) {
      return fetchOne(buildUrl({ start: 0, end: 1, filter: `hash:${hash}` }), signal);
   }

   async function fetchOne(url: string, signal?: AbortSignal) {
      const fetched = await readJson(url, signal);
      if (Result.isError(fetched)) return Result.err<ModelSaberRecord, ModelSaberProblem>(fetched.error);

      const record = fetched.value.flatMap((document) => toRecord(document) ?? []).at(0);
      if (!record) {
         return Result.err<ModelSaberRecord, ModelSaberProblem>({ issue: 'invalid-response', detail: 'the model is not on ModelSaber anymore' });
      }

      return Result.ok<ModelSaberRecord, ModelSaberProblem>(record);
   }

   return { search, getById, getByHash, pageSize: searchPageSize };
}

type CatalogQuery = {
   type?: ModelType;
   start: number;
   end: number;
   sort?: string;
   sortDirection?: string;
   filter?: string;
};

function buildUrl(query: CatalogQuery) {
   const url = new URL(getEndpoint, modelSaberApiOrigin);
   url.searchParams.set('platform', 'pc');
   url.searchParams.set('start', String(query.start));
   url.searchParams.set('end', String(query.end));
   if (query.type) url.searchParams.set('type', query.type);
   if (query.sort) url.searchParams.set('sort', query.sort);
   if (query.sortDirection) url.searchParams.set('sortDirection', query.sortDirection);
   if (query.filter) url.searchParams.set('filter', query.filter);

   return url.toString();
}

function toModelSaberProblem(problem: JsonDocumentProblem): ModelSaberProblem {
   const failed = problem.code === 'json.unreachable' || problem.code === 'json.fetch-failed' || problem.code === 'json.not-found';

   const catalogProblem: ModelSaberProblem = { issue: failed ? 'fetch-failed' : 'invalid-response' };
   if (problem.detail) catalogProblem.detail = problem.detail;
   return catalogProblem;
}

function toRecord(document: ModelSaberDocument): ModelSaberRecord | null {
   const type = modelTypeSchema.safeParse(document.type?.trim().toLowerCase());
   const hash = document.hash?.trim().toLowerCase();
   const downloadUrl = document.download?.trim();
   if (!type.success || !hash || !downloadUrl) return null;

   const id = String(document.id).trim();
   if (!id) return null;

   return {
      summary: {
         id,
         type: type.data,
         name: stripMarkup(document.name) || id,
         author: stripMarkup(document.author),
         hash,
         thumbnailUrl: document.thumbnail?.trim() || null,
         tags:
            document.tags?.flatMap((tag) => {
               const stripped = stripMarkup(tag);
               return stripped ? [stripped] : [];
            }) ?? [],
         publishedAt: document.date?.trim() || null,
         installed: false
      },
      downloadUrl
   };
}

function stripMarkup(value: string | undefined) {
   return (value ?? '').replaceAll(/<[^>]*>/g, '').trim();
}
