import { Result } from 'better-result';

export type HttpsUrlPolicy = {
   allowedHosts?: readonly string[];
};

export type UrlIssue = {
   code: 'invalid-url' | 'unsupported-scheme' | 'embedded-credentials' | 'unsupported-host';
   message: string;
   detail: string;
};

export function resolveHttpsUrl(input: string, policy: HttpsUrlPolicy = {}) {
   const parsed = Result.try({
      try: () => new URL(input),
      catch: (): UrlIssue => ({ code: 'invalid-url', message: 'the address could not be read', detail: input })
   });

   if (Result.isError(parsed)) return Result.err<URL, UrlIssue>(parsed.error);

   const url = parsed.value;

   if (url.protocol !== 'https:') {
      return Result.err<URL, UrlIssue>({ code: 'unsupported-scheme', message: 'only https addresses are allowed', detail: input });
   }

   if (url.username || url.password) {
      return Result.err<URL, UrlIssue>({
         code: 'embedded-credentials',
         message: 'addresses cannot carry sign-in details',
         detail: redactUrl(url)
      });
   }

   if (policy.allowedHosts && !policy.allowedHosts.includes(url.hostname.toLowerCase())) {
      return Result.err<URL, UrlIssue>({ code: 'unsupported-host', message: 'this host is not allowed', detail: url.hostname });
   }

   return Result.ok<URL, UrlIssue>(url);
}

export function redactUrl(url: URL) {
   return `${url.protocol}//${url.host}${url.pathname}`;
}
