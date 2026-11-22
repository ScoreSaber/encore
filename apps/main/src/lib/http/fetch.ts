import { Result } from 'better-result';

import { resolveHttpsUrl, type HttpsUrlPolicy, type UrlIssue } from '@/lib/http/url';

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type HttpsFetchError =
   | { kind: 'url'; issue: UrlIssue }
   | { kind: 'request'; cause: unknown }
   | { kind: 'redirect-missing'; status: number }
   | { kind: 'redirect-invalid'; status: number }
   | { kind: 'too-many-redirects'; maxRedirects: number };

export function combineSignals(timeoutMs: number, signal?: AbortSignal) {
   return AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
}

export async function discardBody(response: Response) {
   await Result.tryPromise(async () => response.body?.cancel());
}

export async function fetchHttps(options: {
   url: string;
   policy?: HttpsUrlPolicy;
   maxRedirects: number;
   send: (url: URL) => Promise<Response>;
}): Promise<Result<{ response: Response; url: URL }, HttpsFetchError>> {
   const first = resolveHttpsUrl(options.url, options.policy);
   if (Result.isError(first)) return Result.err({ kind: 'url', issue: first.error });

   let url = first.value;

   for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
      const attempt = await Result.tryPromise({
         try: () => options.send(url),
         catch: (cause): HttpsFetchError => ({ kind: 'request', cause })
      });
      if (Result.isError(attempt)) return Result.err(attempt.error);

      const response = attempt.value;
      if (!redirectStatuses.has(response.status)) return Result.ok({ response, url });

      await discardBody(response);
      const location = response.headers.get('location');
      if (!location) return Result.err({ kind: 'redirect-missing', status: response.status });
      if (!URL.canParse(location, url)) return Result.err({ kind: 'redirect-invalid', status: response.status });

      const redirected = resolveHttpsUrl(new URL(location, url).href, options.policy);
      if (Result.isError(redirected)) return Result.err({ kind: 'url', issue: redirected.error });

      url = redirected.value;
   }

   return Result.err({ kind: 'too-many-redirects', maxRedirects: options.maxRedirects });
}
