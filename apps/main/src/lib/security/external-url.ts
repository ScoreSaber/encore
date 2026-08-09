import { Result } from 'better-result';

import { resolveHttpsUrl, type UrlIssue } from '@/lib/http/url';

export type ExternalNavigationBlockReason = 'invalid-url' | 'blocked-scheme' | 'blocked-destination' | 'open-failed';

export type ExternalNavigationDecision = { allowed: true; url: string } | { allowed: false; reason: ExternalNavigationBlockReason };

export function evaluateHttpsUrl(input: string): ExternalNavigationDecision {
   const resolved = resolveHttpsUrl(input);
   if (Result.isError(resolved)) return { allowed: false, reason: navigationReason(resolved.error) };

   const url = resolved.value;
   // non-default ports make an external URL unsafe to hand to the OS
   if (url.port || url.hostname === '') return { allowed: false, reason: 'blocked-destination' };

   return {
      allowed: true,
      url: url.toString()
   };
}

function navigationReason(issue: UrlIssue): ExternalNavigationBlockReason {
   if (issue.code === 'invalid-url') return 'invalid-url';
   if (issue.code === 'unsupported-scheme') return 'blocked-scheme';
   return 'blocked-destination';
}

export function openHttpsUrl(input: string, open: (url: string) => Promise<void>) {
   return openUrl(evaluateHttpsUrl(input), open);
}

export async function openUrl(decision: ExternalNavigationDecision, open: (url: string) => Promise<void>): Promise<ExternalNavigationDecision> {
   if (!decision.allowed) return decision;

   const opened = await Result.tryPromise({
      try: () => open(decision.url),
      catch: (): ExternalNavigationBlockReason => 'open-failed'
   });

   if (Result.isError(opened)) {
      return {
         allowed: false,
         reason: opened.error
      };
   }

   return decision;
}

export function isTrustedRendererNavigation(input: string, trustedRendererUrl: string) {
   const parsed = Result.try({
      try: () => ({ input: new URL(input), trusted: new URL(trustedRendererUrl) }),
      catch: () => 'invalid-url'
   });
   if (Result.isError(parsed)) return false;

   const { input: candidate, trusted } = parsed.value;
   if (trusted.protocol === 'file:') {
      return candidate.protocol === 'file:' && candidate.host === trusted.host && candidate.pathname === trusted.pathname;
   }

   return (trusted.protocol === 'http:' || trusted.protocol === 'https:') && candidate.origin === trusted.origin;
}
