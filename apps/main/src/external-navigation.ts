import { evaluateHttpsUrl, openUrl, type ExternalNavigationDecision } from '@/lib/security/external-url';
import { supportLinkUrls } from '@/modules/support/contract';

const supportLinkDestinations = new Set(Object.values(supportLinkUrls).map((url) => new URL(url).toString()));

function evaluateExternalUrl(input: string): ExternalNavigationDecision {
   const decision = evaluateHttpsUrl(input);
   if (!decision.allowed) return decision;

   return isAllowedDestination(new URL(decision.url)) ? decision : { allowed: false, reason: 'blocked-destination' };
}

export function openExternalUrl(input: string, open: (url: string) => Promise<void>) {
   return openUrl(evaluateExternalUrl(input), open);
}

function isAllowedDestination(url: URL) {
   if (supportLinkDestinations.has(url.toString())) return true;

   const hostname = url.hostname.toLowerCase();
   if (hostname === 'scoresaber.com' || hostname.endsWith('.scoresaber.com')) return true;

   const pathname = url.pathname.toLowerCase();
   return hostname === 'github.com' && (pathname === '/scoresaber/encore' || pathname.startsWith('/scoresaber/encore/'));
}
