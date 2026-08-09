import { Result } from 'better-result';

import type { ContentResult } from '@/lib/content/content-errors';
import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import type { ContentProblem, ContentProblemCode } from '@/lib/content/contract';
import { redactUrl, resolveHttpsUrl, type HttpsUrlPolicy, type UrlIssue } from '@/lib/http/url';
import type { OperationProgress } from '@/modules/operations/contract';
import { createThrottledProgress } from '@/modules/operations/main/progress';

import { createHash } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

export type ContentFetch = (url: string, init: { signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

export type DownloadContentOptions = {
   url: string;
   destinationPath: string;
   limits?: Partial<ContentLimits>;
   policy?: HttpsUrlPolicy;
   signal?: AbortSignal;
   onProgress?: (progress: OperationProgress) => void;
   fetchContent?: ContentFetch;
};

export type DownloadedContent = {
   path: string;
   url: string;
   bytes: number;
   sha256: string;
   fileName: string | null;
   contentType: string | null;
};

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
export async function downloadContent(options: DownloadContentOptions): Promise<ContentResult<DownloadedContent>> {
   const limits = resolveContentLimits(options.limits);
   const fetchContent = options.fetchContent ?? ((url, init) => fetch(url, init));
   const scope = createAbortScope(options.signal);

   try {
      const response = await requestContent({ ...options, limits, fetchContent }, scope);
      if (Result.isError(response)) return Result.err<DownloadedContent, ContentProblem>(response.error);

      return await streamToFile({ ...options, limits }, response.value.response, response.value.url, scope);
   } finally {
      scope.release();
   }
}

async function requestContent(
   options: DownloadContentOptions & { limits: ContentLimits; fetchContent: ContentFetch },
   scope: AbortScope
): Promise<ContentResult<{ response: Response; url: URL }>> {
   const first = resolveHttpsUrl(options.url, options.policy);
   if (Result.isError(first)) return Result.err<{ response: Response; url: URL }, ContentProblem>(contentUrlProblem(first.error));

   let url: URL = first.value;

   for (let hop = 0; hop <= options.limits.maxRedirects; hop += 1) {
      scope.arm(options.limits.requestTimeoutMs);
      const attempt = await Result.tryPromise({
         try: () => options.fetchContent(url.href, { signal: scope.signal, redirect: 'manual' }),
         catch: (cause) => describeAbort(options.signal, scope, 'content.download.request-failed', 'the download could not be started', cause)
      });
      scope.disarm();

      if (Result.isError(attempt)) return Result.err<{ response: Response; url: URL }, ContentProblem>(attempt.error);

      const response = attempt.value;
      if (!redirectStatuses.has(response.status)) {
         if (!response.ok) {
            await discardBody(response);
            return Result.err<{ response: Response; url: URL }, ContentProblem>({
               code: 'content.download.http-error',
               message: 'the download server refused the request',
               detail: `HTTP ${response.status}`
            });
         }

         return Result.ok<{ response: Response; url: URL }, ContentProblem>({ response, url });
      }

      await discardBody(response);
      const location = response.headers.get('location');
      if (!location) {
         return Result.err<{ response: Response; url: URL }, ContentProblem>({
            code: 'content.download.redirect-invalid',
            message: 'the download server redirected without an address',
            detail: `HTTP ${response.status}`
         });
      }

      const next = Result.try({
         try: () => new URL(location, url).href,
         catch: (): ContentProblem => ({
            code: 'content.download.redirect-invalid',
            message: 'the download server redirected to an address that could not be read'
         })
      });
      if (Result.isError(next)) return Result.err<{ response: Response; url: URL }, ContentProblem>(next.error);

      const redirected = resolveHttpsUrl(next.value, options.policy);
      if (Result.isError(redirected)) {
         return Result.err<{ response: Response; url: URL }, ContentProblem>(contentUrlProblem(redirected.error));
      }

      url = redirected.value;
   }

   return Result.err<{ response: Response; url: URL }, ContentProblem>({
      code: 'content.download.too-many-redirects',
      message: 'the download server redirected too many times',
      detail: `${options.limits.maxRedirects} redirects`
   });
}

function contentUrlProblem(issue: UrlIssue): ContentProblem {
   return { code: `content.source.${issue.code}`, message: issue.message, detail: issue.detail };
}

async function streamToFile(
   options: DownloadContentOptions & { limits: ContentLimits },
   response: Response,
   url: URL,
   scope: AbortScope
): Promise<ContentResult<DownloadedContent>> {
   const contentLength = response.headers.get('content-length');
   const parsedContentLength = contentLength ? Number(contentLength) : Number.NaN;
   const declaredBytes = Number.isFinite(parsedContentLength) && parsedContentLength >= 0 ? parsedContentLength : null;
   if (declaredBytes !== null && declaredBytes > options.limits.maxDownloadBytes) {
      await discardBody(response);
      return Result.err<DownloadedContent, ContentProblem>(tooLarge(options.limits.maxDownloadBytes));
   }

   const body = response.body;
   if (!body) {
      return Result.err<DownloadedContent, ContentProblem>({
         code: 'content.download.request-failed',
         message: 'the download server returned no content'
      });
   }

   const prepared = await Result.tryPromise({
      try: () => mkdir(dirname(options.destinationPath), { recursive: true }),
      catch: (cause): ContentProblem => ({
         code: 'content.download.write-failed',
         message: 'the staging folder for the download could not be created',
         path: dirname(options.destinationPath),
         detail: String(cause)
      })
   });
   if (Result.isError(prepared)) {
      await discardBody(response);
      return Result.err<DownloadedContent, ContentProblem>(prepared.error);
   }

   const handle = await Result.tryPromise({
      try: () => open(options.destinationPath, 'w'),
      catch: (cause): ContentProblem => ({
         code: 'content.download.write-failed',
         message: 'the download could not be written to staging',
         path: options.destinationPath,
         detail: String(cause)
      })
   });
   if (Result.isError(handle)) {
      await discardBody(response);
      return Result.err<DownloadedContent, ContentProblem>(handle.error);
   }

   const hash = createHash('sha256');
   const reader = body.getReader();
   const report = createThrottledProgress(options.onProgress);
   let bytes = 0;
   let failure: ContentProblem | null = null;

   try {
      for (;;) {
         if (scope.signal.aborted) {
            failure = describeAbort(options.signal, scope, 'content.download.request-failed', 'the download stopped early', null);
            break;
         }

         scope.arm(options.limits.stallTimeoutMs);
         const chunk = await reader.read();
         scope.disarm();
         if (chunk.done) break;

         bytes += chunk.value.byteLength;
         if (bytes > options.limits.maxDownloadBytes) {
            failure = tooLarge(options.limits.maxDownloadBytes);
            break;
         }

         hash.update(chunk.value);
         await handle.value.write(chunk.value);
         report({
            phase: 'downloading',
            current: bytes,
            total: declaredBytes ?? undefined,
            percent: declaredBytes ? Math.min(100, Math.round((bytes / declaredBytes) * 100)) : undefined,
            unit: 'bytes'
         });
      }
   } catch (cause) {
      failure = describeAbort(options.signal, scope, 'content.download.write-failed', 'the download stopped early', cause);
   } finally {
      scope.disarm();
      await handle.value.close();
      await reader.cancel().catch(() => null);
   }

   if (failure) {
      await rm(options.destinationPath, { force: true }).catch(() => null);
      return Result.err<DownloadedContent, ContentProblem>(failure);
   }

   report({ phase: 'downloading', current: bytes, total: bytes, percent: 100, unit: 'bytes' }, { force: true });

   return Result.ok<DownloadedContent, ContentProblem>({
      path: options.destinationPath,
      url: redactUrl(url),
      bytes,
      sha256: hash.digest('hex'),
      fileName: readFileName(response, url),
      contentType: response.headers.get('content-type')
   });
}

type AbortScope = {
   signal: AbortSignal;
   arm: (durationMs: number) => void;
   disarm: () => void;
   release: () => void;
   isTimedOut: () => boolean;
};

function createAbortScope(external?: AbortSignal): AbortScope {
   const controller = new AbortController();
   let timer: ReturnType<typeof setTimeout> | null = null;
   let timedOut = false;

   const forwardAbort = () => controller.abort();
   if (external?.aborted) controller.abort();
   else external?.addEventListener('abort', forwardAbort, { once: true });

   const disarm = () => {
      if (timer) clearTimeout(timer);
      timer = null;
   };

   return {
      signal: controller.signal,
      arm: (durationMs) => {
         disarm();
         timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
         }, durationMs);
      },
      disarm,
      release: () => {
         disarm();
         external?.removeEventListener('abort', forwardAbort);
      },
      isTimedOut: () => timedOut
   };
}

function describeAbort(
   external: AbortSignal | undefined,
   scope: AbortScope,
   code: ContentProblemCode,
   message: string,
   cause: unknown
): ContentProblem {
   if (external?.aborted) return { code: 'content.download.cancelled', message: 'the download was cancelled' };
   if (scope.isTimedOut()) return { code: 'content.download.timed-out', message: 'the download server stopped responding' };

   return { code, message, ...(cause ? { detail: String(cause) } : {}) };
}

function tooLarge(maxBytes: number): ContentProblem {
   return {
      code: 'content.download.too-large',
      message: 'the download is larger than the allowed size',
      detail: `${maxBytes} bytes`
   };
}

function readFileName(response: Response, url: URL) {
   const disposition = response.headers.get('content-disposition');
   const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
   const candidate = match?.[1] ?? decodeURIComponent(posix.basename(url.pathname));
   const name = candidate.replaceAll('\\', '/').split('/').pop()?.trim();

   return name && name !== '.' && name !== '..' ? name : null;
}

async function discardBody(response: Response) {
   await response.body?.cancel().catch(() => null);
}
