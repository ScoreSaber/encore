import { Result } from 'better-result';

import type { ModFundingResult, ModLinkRequest } from '@/modules/mods/contract';
import { githubRepositoryFromUrl, type GitHubRepository } from '@/modules/mods/contract';

export type GitHubFundingFetch = (url: string, init: { method: 'HEAD'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export function createGitHubFundingService(options: { fetchFunding?: GitHubFundingFetch; timeoutMs?: number } = {}) {
   const fetchFunding = options.fetchFunding ?? fetch;
   const cache = new Map<string, Promise<ModFundingResult>>();

   return {
      async get(request: ModLinkRequest): Promise<ModFundingResult> {
         const repository = githubRepositoryFromUrl(request.url);
         if (!repository) return { status: 'unavailable' };

         const key = `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`;
         const cached = cache.get(key);
         if (cached) return cached;

         const pending = checkFundingFile(repository, fetchFunding, options.timeoutMs);
         cache.set(key, pending);
         return pending;
      }
   };
}

async function checkFundingFile(repository: GitHubRepository, fetchFunding: GitHubFundingFetch, timeoutMs = 5_000): Promise<ModFundingResult> {
   const owner = encodeURIComponent(repository.owner);
   const repo = encodeURIComponent(repository.repo);

   for (const fileName of ['FUNDING.yml', 'FUNDING.yaml']) {
      const response = await Result.tryPromise({
         try: () =>
            fetchFunding(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.github/${fileName}`, {
               method: 'HEAD',
               signal: AbortSignal.timeout(timeoutMs),
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
