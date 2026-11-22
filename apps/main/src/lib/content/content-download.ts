import { Result } from 'better-result';

import { resolveContentLimits, type ContentLimits } from '@/lib/content/content-limits';
import type { ContentProblem } from '@/lib/content/contract';
import { createProblem } from '@/lib/errors';
import { removeQuietly } from '@/lib/filesystem/path';
import { discardBody, fetchHttps, type HttpsFetchError } from '@/lib/http/fetch';
import { redactUrl, type HttpsUrlPolicy } from '@/lib/http/url';
import { bytesProgress, percentOf, throttleReports } from '@/lib/progress';
import type { OperationProgress } from '@/modules/operations/contract';

import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, posix } from 'node:path';

export type ContentFetch = (url: string, init: { signal: AbortSignal; redirect: 'manual' }) => Promise<Response>;

type DownloadContentOptions = {
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

export async function downloadContent(options: DownloadContentOptions): Promise<Result<DownloadedContent, ContentProblem>> {
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
): Promise<Result<{ response: Response; url: URL }, ContentProblem>> {
   const fetched = await fetchHttps({
      url: options.url,
      policy: options.policy,
      maxRedirects: options.limits.maxRedirects,
      send: async (url) => {
         scope.arm(options.limits.requestTimeoutMs);
         try {
            return await options.fetchContent(url.href, { signal: scope.signal, redirect: 'manual' });
         } finally {
            scope.disarm();
         }
      }
   });
   if (Result.isError(fetched)) return Result.err(contentFetchError(fetched.error, options.signal, scope));

   const { response, url } = fetched.value;
   if (!response.ok) {
      await discardBody(response);
      return Result.err(createProblem('content.download.http-error', { detail: `HTTP ${response.status}` }));
   }

   return Result.ok({ response, url });
}

function contentFetchError(error: HttpsFetchError, external: AbortSignal | undefined, scope: AbortScope): ContentProblem {
   switch (error.kind) {
      case 'url':
         return { code: `content.source.${error.issue.code}`, message: error.issue.message, detail: error.issue.detail };
      case 'request':
         return describeAbort(external, scope, createProblem('content.download.request-failed', { cause: error.cause }));
      case 'redirect-missing':
         return createProblem('content.download.redirect-missing', { detail: `HTTP ${error.status}` });
      case 'redirect-invalid':
         return createProblem('content.download.redirect-invalid');
      case 'too-many-redirects':
         return createProblem('content.download.too-many-redirects', { detail: `${error.maxRedirects} redirects` });
   }
}

async function streamToFile(
   options: DownloadContentOptions & { limits: ContentLimits },
   response: Response,
   url: URL,
   scope: AbortScope
): Promise<Result<DownloadedContent, ContentProblem>> {
   const contentLength = response.headers.get('content-length');
   const parsedContentLength = contentLength ? Number(contentLength) : Number.NaN;
   const declaredBytes = Number.isFinite(parsedContentLength) && parsedContentLength >= 0 ? parsedContentLength : null;
   if (declaredBytes !== null && declaredBytes > options.limits.maxDownloadBytes) {
      await discardBody(response);
      return Result.err<DownloadedContent, ContentProblem>(
         createProblem('content.download.too-large', { detail: `${options.limits.maxDownloadBytes} bytes` })
      );
   }

   const body = response.body;
   if (!body) {
      return Result.err<DownloadedContent, ContentProblem>(createProblem('content.download.empty'));
   }

   const prepared = await Result.tryPromise({
      try: () => mkdir(dirname(options.destinationPath), { recursive: true }),
      catch: (cause): ContentProblem => createProblem('content.staging.failed', { path: dirname(options.destinationPath), cause })
   });
   if (Result.isError(prepared)) {
      await discardBody(response);
      return Result.err<DownloadedContent, ContentProblem>(prepared.error);
   }

   const handle = await Result.tryPromise({
      try: () => open(options.destinationPath, 'w'),
      catch: (cause): ContentProblem => createProblem('content.download.write-failed', { path: options.destinationPath, cause })
   });
   if (Result.isError(handle)) {
      await discardBody(response);
      return Result.err<DownloadedContent, ContentProblem>(handle.error);
   }

   const hash = createHash('sha256');
   const reader = body.getReader();
   const report = throttleReports(options.onProgress);
   let bytes = 0;

   const streamed = await Result.tryPromise({
      try: async () => {
         for (;;) {
            if (scope.signal.aborted) {
               return Result.err<void, ContentProblem>(describeAbort(options.signal, scope, createProblem('content.download.interrupted')));
            }

            scope.arm(options.limits.stallTimeoutMs);
            const chunk = await reader.read();
            scope.disarm();
            if (chunk.done) return Result.ok<void, ContentProblem>(undefined);

            bytes += chunk.value.byteLength;
            if (bytes > options.limits.maxDownloadBytes) {
               return Result.err<void, ContentProblem>(
                  createProblem('content.download.too-large', { detail: `${options.limits.maxDownloadBytes} bytes` })
               );
            }

            hash.update(chunk.value);
            await handle.value.write(chunk.value);
            report({
               phase: 'downloading',
               current: bytes,
               total: declaredBytes ?? undefined,
               percent: declaredBytes ? percentOf(bytes, declaredBytes) : undefined,
               unit: 'bytes'
            });
         }
      },
      catch: (cause) => describeAbort(options.signal, scope, createProblem('content.download.interrupted', { cause }))
   }).then(Result.flatten);
   scope.disarm();
   await handle.value.close();
   await Result.tryPromise(() => reader.cancel());

   if (Result.isError(streamed)) {
      await removeQuietly(options.destinationPath);
      return Result.err<DownloadedContent, ContentProblem>(streamed.error);
   }

   report(bytesProgress('downloading', bytes, bytes), true);

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

function describeAbort(external: AbortSignal | undefined, scope: AbortScope, problem: ContentProblem): ContentProblem {
   if (external?.aborted) return createProblem('content.download.cancelled');
   if (scope.isTimedOut()) return createProblem('content.download.timed-out');

   return problem;
}

function readFileName(response: Response, url: URL) {
   const disposition = response.headers.get('content-disposition');
   const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
   const urlName = posix.basename(url.pathname);
   const candidate = match?.[1] ?? Result.try(() => decodeURIComponent(urlName)).unwrapOr(urlName);
   const name = candidate.replaceAll('\\', '/').split('/').pop()?.trim();

   return name && name !== '.' && name !== '..' ? name : null;
}
