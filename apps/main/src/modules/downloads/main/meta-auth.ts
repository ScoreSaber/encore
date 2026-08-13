import type { Result } from 'better-result';

export type MetaAuthProblem = {
   code: 'downloads.oculus.sign-in-cancelled' | 'downloads.oculus.sign-in-failed' | 'downloads.oculus.sign-in-timed-out';
   message: string;
};

export type MetaAuthRequest = (options: { signal: AbortSignal }) => Promise<Result<string, MetaAuthProblem>>;

type MetaAuthProblems = {
   cancelled: MetaAuthProblem;
   failed: MetaAuthProblem;
   timedOut: MetaAuthProblem;
};

export const metaAuthProblems: MetaAuthProblems = {
   cancelled: {
      code: 'downloads.oculus.sign-in-cancelled',
      message: 'the Meta sign-in window was closed before the download started'
   },
   failed: {
      code: 'downloads.oculus.sign-in-failed',
      message: 'the Meta sign-in did not return a usable session'
   },
   timedOut: {
      code: 'downloads.oculus.sign-in-timed-out',
      message: 'the Meta sign-in window was open too long'
   }
};

export function isMetaAuthToken(value: string | undefined): value is string {
   if (!value) return false;
   if (value.includes('%') || value.includes('|') || value.includes(':')) return false;
   if (!value.startsWith('FRL') && !value.startsWith('OC')) return false;

   return !/^OC\d{15}/.test(value);
}
