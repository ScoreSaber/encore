import { Result } from 'better-result';

import { translateProblem } from '@/lib/messages';

export type HttpsUrlPolicy = {
   allowedHosts?: readonly string[];
};

type UrlIssueCode = 'invalid-url' | 'unsupported-scheme' | 'embedded-credentials' | 'unsupported-host';

export type UrlIssue = {
   code: UrlIssueCode;
   message: string;
   detail: string;
};

function urlIssue(code: UrlIssueCode, detail: string) {
   return Result.err<URL, UrlIssue>({ code, message: translateProblem(`url.${code}`), detail });
}

export function resolveHttpsUrl(input: string, policy: HttpsUrlPolicy = {}) {
   if (!URL.canParse(input)) return urlIssue('invalid-url', input);

   const url = new URL(input);
   if (url.protocol !== 'https:') return urlIssue('unsupported-scheme', input);
   if (url.username || url.password) return urlIssue('embedded-credentials', redactUrl(url));
   if (policy.allowedHosts && !policy.allowedHosts.includes(url.hostname.toLowerCase())) return urlIssue('unsupported-host', url.hostname);

   return Result.ok<URL, UrlIssue>(url);
}

export function redactUrl(url: URL) {
   return `${url.protocol}//${url.host}${url.pathname}`;
}

const githubAssetHosts = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'];

export function downloadHostsFor(host: string) {
   return host === 'github.com' ? [host, ...githubAssetHosts] : [host];
}
