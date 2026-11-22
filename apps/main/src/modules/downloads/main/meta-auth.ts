import type { Result } from 'better-result';

import type { Problem } from '@/lib/errors';

export type MetaAuthProblem = Problem<
   'downloads.oculus.sign-in-cancelled' | 'downloads.oculus.sign-in-failed' | 'downloads.oculus.sign-in-timed-out'
>;

export type MetaAuthRequest = (options: { signal: AbortSignal }) => Promise<Result<string, MetaAuthProblem>>;

export function isMetaAuthToken(value: string | undefined): value is string {
   if (!value) return false;
   if (value.includes('%') || value.includes('|') || value.includes(':')) return false;
   if (!value.startsWith('FRL') && !value.startsWith('OC')) return false;

   return !/^OC\d{15}/.test(value);
}
