import { queryOptions } from '@tanstack/react-query';

import type { TargetModRequest } from '@/modules/mods/api';
import { apiKey, installKey, snapshotGcTime, targetQuery } from '@/renderer/query/api-query';

export function modListQueryOptions(request: TargetModRequest) {
   return queryOptions({
      ...targetQuery(installKey('mods', request, 'getMods'), () => window.encore.mods.getMods(request)),
      staleTime: Infinity,
      gcTime: snapshotGcTime
   });
}

export function modFundingQueryOptions(url: string) {
   return queryOptions({
      queryKey: apiKey('mods', 'getFunding', url),
      queryFn: () => window.encore.mods.getFunding({ url }),
      staleTime: Infinity
   });
}

export const modRepositoryListQueryOptions = queryOptions({
   queryKey: apiKey('mods', 'getRepositories'),
   queryFn: () => window.encore.mods.getRepositories()
});
