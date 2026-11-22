import { Result } from 'better-result';

import { readRecent, setRecent } from '@/lib/content/content-cache';
import { githubRepositoryFromUrl, type GitHubRepository, type ModFundingResult, type ModLinkRequest } from '@/modules/mods/contract';

const fundingTimeoutMs = 5_000;
const availableTtlMs = 60 * 60 * 1_000;
const unavailableTtlMs = 5 * 60 * 1_000;
const maxCachedFunding = 200;

type CachedFunding = {
   result: ModFundingResult;
   expiresAt: number;
};

export function createGitHubFundingService() {
   const cache = new Map<string, CachedFunding>();
   const inFlight = new Map<string, Promise<ModFundingResult>>();

   return {
      async get(request: ModLinkRequest): Promise<ModFundingResult> {
         const repository = githubRepositoryFromUrl(request.url);
         if (!repository) return { status: 'unavailable' };

         const key = `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`;
         const cached = readRecent(cache, key);
         if (cached && cached.expiresAt > Date.now()) return cached.result;
         if (cached) cache.delete(key);

         const existing = inFlight.get(key);
         if (existing) return existing;

         const pending = checkFundingFile(repository)
            .then((result) => {
               const ttl = result.status === 'available' ? availableTtlMs : unavailableTtlMs;
               setRecent(cache, key, { result, expiresAt: Date.now() + ttl }, maxCachedFunding);
               return result;
            })
            .finally(() => {
               if (inFlight.get(key) === pending) inFlight.delete(key);
            });
         inFlight.set(key, pending);
         return pending;
      }
   };
}

async function checkFundingFile(repository: GitHubRepository): Promise<ModFundingResult> {
   const owner = encodeURIComponent(repository.owner);
   const repo = encodeURIComponent(repository.repo);

   for (const fileName of ['FUNDING.yml', 'FUNDING.yaml']) {
      const response = await Result.tryPromise({
         try: () =>
            fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.github/${fileName}`, {
               method: 'HEAD',
               signal: AbortSignal.timeout(fundingTimeoutMs),
               headers: { accept: 'text/plain' }
            }),
         catch: () => undefined
      });

      if (Result.isOk(response) && response.value.ok) {
         const url = new URL(`https://github.com/${repository.owner}/${repository.repo}`);
         url.searchParams.set('sponsor', '1');
         return { status: 'available', url: url.href };
      }
   }

   return { status: 'unavailable' };
}
