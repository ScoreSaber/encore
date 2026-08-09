import { queryOptions } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { modsApi, type TargetModRequest } from '@/modules/mods/api';
import { modsIpc } from '@/modules/mods/ipc';
import { snapshotQueryGcTime } from '@/renderer/query/utils';
import { ipcQueryKey } from '@/renderer/query/utils';

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
