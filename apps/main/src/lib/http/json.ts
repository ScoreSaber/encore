import { Result } from 'better-result';
import { z } from 'zod';

import { causeMessage } from '@/lib/errors';
import { redactUrl, resolveHttpsUrl, type HttpsUrlPolicy } from '@/lib/http/url';

export type JsonDocumentProblemCode =
   | 'json.fetch-failed'
   | 'json.invalid'
   | 'json.not-found'
   | 'json.redirect-invalid'
   | 'json.too-large'
   | 'json.unexpected-shape'
   | 'json.unreachable'
   | 'json.unsupported-url';

export type JsonDocumentProblem = {
   code: JsonDocumentProblemCode;
   message: string;
   detail?: string;
};

export type JsonDocumentResult<T> = Result<T, JsonDocumentProblem>;

export type JsonDocumentFetch = (
   url: string,
   init: { signal: AbortSignal; headers: Record<string, string>; redirect?: 'manual' }
) => Promise<Response>;

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

export type JsonDocumentRequest = {
   url: string;
   policy?: HttpsUrlPolicy;
   etag?: string | null;
   lastModified?: string | null;
   maxBytes?: number;
   timeoutMs?: number;
   maxRedirects?: number;
   signal?: AbortSignal;
   fetchJson?: JsonDocumentFetch;
};

type JsonRequestHeaders = {
   accept: string;
   'if-none-match'?: string;
   'if-modified-since'?: string;
};

export type JsonDocument =
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
const defaultMaxRedirects = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function fetchJsonDocument(request: JsonDocumentRequest): Promise<JsonDocumentResult<JsonDocument>> {
   const maxBytes = request.maxBytes ?? defaultMaxBytes;
   const fetchJson = request.fetchJson ?? ((url, init) => fetch(url, init));
   const first = resolveHttpsUrl(request.url, request.policy);
   if (Result.isError(first)) {
      const problem: JsonDocumentProblem = { code: 'json.unsupported-url', message: first.error.message };
      if (first.error.detail) problem.detail = first.error.detail;
      return Result.err<JsonDocument, JsonDocumentProblem>(problem);
   }

   let url = first.value;

   for (let hop = 0; hop <= (request.maxRedirects ?? defaultMaxRedirects); hop += 1) {
      const attempt = await Result.tryPromise({
         try: () =>
            fetchJson(url.href, {
               signal: AbortSignal.any([AbortSignal.timeout(request.timeoutMs ?? defaultTimeoutMs), ...(request.signal ? [request.signal] : [])]),
               redirect: 'manual',
               headers: conditionalHeaders(request)
            }),
         catch: (cause): JsonDocumentProblem => ({
            code: 'json.unreachable',
            message: 'the address could not be reached',
            detail: causeMessage(cause)
         })
      });
      if (Result.isError(attempt)) return Result.err<JsonDocument, JsonDocumentProblem>(attempt.error);

      const response = attempt.value;
      if (response.status === 304) {
         await discardBody(response);
         return Result.ok<JsonDocument, JsonDocumentProblem>({ status: 'not-modified' });
      }

      if (!redirectStatuses.has(response.status)) {
         if (!response.ok) {
            await discardBody(response);
            return Result.err<JsonDocument, JsonDocumentProblem>({
               code: response.status === 404 ? 'json.not-found' : 'json.fetch-failed',
               message: response.status === 404 ? 'there is no document at that address' : 'the server answered with an error',
               detail: `HTTP ${response.status}`
            });
         }

         const parsed = await readBoundedJson(response, maxBytes);
         if (Result.isError(parsed)) return Result.err<JsonDocument, JsonDocumentProblem>(parsed.error);

         return Result.ok<JsonDocument, JsonDocumentProblem>({
            status: 'ok',
            url: redactUrl(url),
            value: parsed.value,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified')
         });
      }

      await discardBody(response);
      const next = readRedirect(response, url, request.policy);
      if (Result.isError(next)) return Result.err<JsonDocument, JsonDocumentProblem>(next.error);

      url = next.value;
   }

   return Result.err<JsonDocument, JsonDocumentProblem>({
      code: 'json.redirect-invalid',
      message: 'the server redirected too many times',
      detail: `${request.maxRedirects ?? defaultMaxRedirects} redirects`
   });
}

export type JsonResourceRequest<Output> = {
   url: string;
   schema: z.ZodType<Output>;
   maxBytes?: number;
   timeoutMs?: number;
   signal?: AbortSignal;
   fetchJson?: JsonDocumentFetch;
};

export async function fetchJsonResource<Output>(request: JsonResourceRequest<Output>): Promise<JsonDocumentResult<Output>> {
   const fetchJson = request.fetchJson ?? ((url, init) => fetch(url, init));
   const response = await Result.tryPromise({
      try: () =>
         fetchJson(request.url, {
            signal: request.signal ?? AbortSignal.timeout(request.timeoutMs ?? defaultTimeoutMs),
            headers: { accept: 'application/json' }
         }),
      catch: (cause): JsonDocumentProblem => ({
         code: 'json.unreachable',
         message: 'the address could not be reached',
         detail: causeMessage(cause)
      })
   });
   if (Result.isError(response)) return Result.err<Output, JsonDocumentProblem>(response.error);

   if (!response.value.ok) {
      await discardBody(response.value);
      return Result.err<Output, JsonDocumentProblem>({
         code: response.value.status === 404 ? 'json.not-found' : 'json.fetch-failed',
         message: 'the server answered with an error',
         detail: `HTTP ${response.value.status}`
      });
   }

   const parsed = await readBoundedJson(response.value, request.maxBytes ?? defaultMaxBytes);
   if (Result.isError(parsed)) return Result.err<Output, JsonDocumentProblem>(parsed.error);

   const validated = request.schema.safeParse(parsed.value);

   return validated.success
      ? Result.ok<Output, JsonDocumentProblem>(validated.data)
      : Result.err<Output, JsonDocumentProblem>({
           code: 'json.unexpected-shape',
           message: 'the answer was not the expected shape',
           detail: validated.error.message
        });
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<JsonDocumentResult<z.infer<ReturnType<typeof z.json>>>> {
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
               throw new Error(`larger than ${maxBytes} bytes`);
            }

            output += decoder.decode(chunk.value, { stream: true });
         }

         return output + decoder.decode();
      },
      catch: (cause): JsonDocumentProblem => ({
         code: 'json.too-large',
         message: 'the answer could not be read',
         detail: causeMessage(cause)
      })
   });
   if (Result.isError(text)) return text;

   return Result.try({
      try: () => z.json().parse(JSON.parse(text.value)),
      catch: (cause): JsonDocumentProblem => ({
         code: 'json.invalid',
         message: 'the answer was not valid JSON',
         detail: causeMessage(cause)
      })
   });
}

function readRedirect(response: Response, url: URL, policy: HttpsUrlPolicy | undefined): JsonDocumentResult<URL> {
   const location = response.headers.get('location');
   if (!location) {
      return Result.err<URL, JsonDocumentProblem>({
         code: 'json.redirect-invalid',
         message: 'the server redirected without an address',
         detail: `HTTP ${response.status}`
      });
   }

   const next = Result.try({
      try: () => new URL(location, url),
      catch: (): JsonDocumentProblem => ({ code: 'json.redirect-invalid', message: 'the server redirected to an address that could not be read' })
   });
   if (Result.isError(next)) return Result.err<URL, JsonDocumentProblem>(next.error);

   const resolved = resolveHttpsUrl(next.value.href, policy);

   if (Result.isOk(resolved)) return Result.ok<URL, JsonDocumentProblem>(resolved.value);

   const problem: JsonDocumentProblem = { code: 'json.unsupported-url', message: resolved.error.message };
   if (resolved.error.detail) problem.detail = resolved.error.detail;
   return Result.err<URL, JsonDocumentProblem>(problem);
}

function conditionalHeaders(request: JsonDocumentRequest) {
   const headers: JsonRequestHeaders = { accept: 'application/json' };
   if (request.etag) headers['if-none-match'] = request.etag;
   if (request.lastModified) headers['if-modified-since'] = request.lastModified;
   return headers;
}

async function discardBody(response: Response) {
   await response.body?.cancel().catch(() => null);
}
