import { queryOptions } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/app/ipc/target-api';
import { snapshotQueryGcTime } from '@/app/renderer/query/utils';
import { ipcQueryKey } from '@/app/renderer/query/utils';
import { modsApi, type TargetModRequest } from '@/modules/mods/api';
import { modsIpc } from '@/modules/mods/ipc';

const modsTargetIpc = createTargetIpcDescriptor(modsApi);

export function modListQueryOptions(request: TargetModRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(modsTargetIpc.getMods, request.targetId, request.installId),
      queryFn: () => window.encore.mods.getMods(request),
      staleTime: Infinity,
      gcTime: snapshotQueryGcTime
   });
}

export function modFundingQueryOptions(url: string) {
   return queryOptions({
      queryKey: ipcQueryKey(modsIpc.getFunding, url),
      queryFn: () => window.encore.mods.getFunding({ url }),
      staleTime: Infinity
   });
}

export const modRepositoryListQueryOptions = queryOptions({
   queryKey: ipcQueryKey(modsIpc.getRepositories),
   queryFn: () => window.encore.mods.getRepositories()
});
