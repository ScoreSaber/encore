import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem, type Problem } from '@/lib/errors';
import { combineSignals, discardBody, fetchHttps, type HttpsFetchError } from '@/lib/http/fetch';
import { redactUrl, type HttpsUrlPolicy } from '@/lib/http/url';

type JsonDocumentProblemCode =
   | 'json.fetch-failed'
   | 'json.invalid'
   | 'json.not-found'
   | 'json.redirect-invalid'
   | 'json.too-large'
   | 'json.too-many-redirects'
   | 'json.unexpected-shape'
   | 'json.unreadable'
   | 'json.unreachable'
   | 'json.unsupported-url';

export type JsonDocumentProblem = Problem<JsonDocumentProblemCode>;

type CatalogProblem = {
   issue: 'fetch-failed' | 'invalid-response';
   detail?: string;
};

export type JsonDocumentFetch = (
   url: string,
   init: { signal: AbortSignal; headers: Record<string, string>; redirect?: 'manual' }
) => Promise<Response>;

type JsonValue = z.infer<ReturnType<typeof z.json>>;

type JsonDocumentRequest = {
   url: string;
   policy?: HttpsUrlPolicy;
   etag?: string | null;
   lastModified?: string | null;
   maxBytes?: number;
   timeoutMs?: number;
   signal?: AbortSignal;
   fetchJson?: JsonDocumentFetch;
};

type JsonRequestHeaders = {
   accept: string;
   'if-none-match'?: string;
   'if-modified-since'?: string;
};

type JsonDocument =
   | {
        status: 'ok';
        url: string;
        value: JsonValue;
        etag: string | null;
        lastModified: string | null;
     }
   | { status: 'not-modified' };

const defaultMaxBytes = 16 * 1024 * 1024;
const defaultTimeoutMs = 15_000;
const maxRedirects = 5;

export async function fetchJsonDocument(request: JsonDocumentRequest): Promise<Result<JsonDocument, JsonDocumentProblem>> {
   const maxBytes = request.maxBytes ?? defaultMaxBytes;
   const fetchJson = request.fetchJson ?? ((url, init) => fetch(url, init));
   const fetched = await fetchHttps({
      url: request.url,
      policy: request.policy,
      maxRedirects,
      send: (url) =>
         fetchJson(url.href, {
            signal: combineSignals(request.timeoutMs ?? defaultTimeoutMs, request.signal),
            redirect: 'manual',
            headers: conditionalHeaders(request)
         })
   });
   if (Result.isError(fetched)) return Result.err(jsonFetchError(fetched.error));

   const { response, url } = fetched.value;
   if (response.status === 304) {
      await discardBody(response);
      return Result.ok<JsonDocument, JsonDocumentProblem>({ status: 'not-modified' });
   }

   if (!response.ok) {
      await discardBody(response);
      return Result.err(httpFailure(response));
   }

   const parsed = await readBoundedJson(response, maxBytes);
   if (Result.isError(parsed)) return Result.err(parsed.error);

   return Result.ok<JsonDocument, JsonDocumentProblem>({
      status: 'ok',
      url: redactUrl(url),
      value: parsed.value,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
   });
}

type JsonResourceRequest<Output> = {
   url: string;
   schema: z.ZodType<Output>;
   maxBytes?: number;
   timeoutMs?: number;
   signal?: AbortSignal;
   fetchJson?: JsonDocumentFetch;
};

export async function fetchJsonResource<Output>(request: JsonResourceRequest<Output>): Promise<Result<Output, JsonDocumentProblem>> {
   const fetchJson = request.fetchJson ?? ((url, init) => fetch(url, init));
   const response = await Result.tryPromise({
      try: () =>
         fetchJson(request.url, {
            signal: combineSignals(request.timeoutMs ?? defaultTimeoutMs, request.signal),
            headers: { accept: 'application/json' }
         }),
      catch: (cause) => createProblem('json.unreachable', { cause })
   });
   if (Result.isError(response)) return Result.err(response.error);

   if (!response.value.ok) {
      await discardBody(response.value);
      return Result.err(httpFailure(response.value));
   }

   const parsed = await readBoundedJson(response.value, request.maxBytes ?? defaultMaxBytes);
   if (Result.isError(parsed)) return Result.err(parsed.error);

   const validated = request.schema.safeParse(parsed.value);

   return validated.success ? Result.ok(validated.data) : Result.err(createProblem('json.unexpected-shape', { detail: validated.error.message }));
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<Result<JsonValue, JsonDocumentProblem>> {
   const text = await Result.tryPromise({
      try: async () => {
         const body = response.body;
         if (!body) return '';

         const decoder = new TextDecoder();
         const reader = body.getReader();
         let bytes = 0;
         let output = '';

         for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;

            bytes += chunk.value.byteLength;
            if (bytes > maxBytes) {
               await reader.cancel();
               return null;
            }

            output += decoder.decode(chunk.value, { stream: true });
         }

         return output + decoder.decode();
      },
      catch: (cause) => createProblem('json.unreadable', { cause })
   });
   if (Result.isError(text)) return Result.err(text.error);
   if (text.value === null) return Result.err(createProblem('json.too-large', { detail: `${maxBytes} bytes` }));

   const json = text.value;
   return Result.try({
      try: () => z.json().parse(JSON.parse(json)),
      catch: (cause) => createProblem('json.invalid', { cause })
   });
}

function jsonFetchError(error: HttpsFetchError): JsonDocumentProblem {
   switch (error.kind) {
      case 'url':
         return { code: 'json.unsupported-url', message: error.issue.message, detail: error.issue.detail };
      case 'request':
         return createProblem('json.unreachable', { cause: error.cause });
      case 'redirect-missing':
      case 'redirect-invalid':
         return createProblem('json.redirect-invalid', { detail: `HTTP ${error.status}` });
      case 'too-many-redirects':
         return createProblem('json.too-many-redirects', { detail: `${error.maxRedirects} redirects` });
   }
}

function httpFailure(response: Response) {
   return createProblem(response.status === 404 ? 'json.not-found' : 'json.fetch-failed', { detail: `HTTP ${response.status}` });
}

function conditionalHeaders(request: JsonDocumentRequest) {
   const headers: JsonRequestHeaders = { accept: 'application/json' };
   if (request.etag) headers['if-none-match'] = request.etag;
   if (request.lastModified) headers['if-modified-since'] = request.lastModified;
   return headers;
}

export function toCatalogProblem(problem: JsonDocumentProblem): CatalogProblem {
   const failed = problem.code === 'json.unreachable' || problem.code === 'json.fetch-failed' || problem.code === 'json.not-found';
   const catalogProblem: CatalogProblem = { issue: failed ? 'fetch-failed' : 'invalid-response' };
   if (problem.detail) catalogProblem.detail = problem.detail;
   return catalogProblem;
}
