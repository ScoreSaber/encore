import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { sharedContentApi, type TargetSharedContentRequest } from '@/modules/shared-content/api';
import type { TargetId } from '@/modules/targets/contract';
import { ipcQueryKey, setExistingQueryData, snapshotQueryGcTime } from '@/renderer/query/utils';

const sharedContentTargetIpc = createTargetIpcDescriptor(sharedContentApi);

export function sharedContentListQueryOptions(request: TargetSharedContentRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(sharedContentTargetIpc.list, request.targetId, request.installId),
      queryFn: () => window.encore.sharedContent.list(request),
      gcTime: snapshotQueryGcTime
   });
}

export function sharedContentOverviewQueryOptions(targetId: TargetId) {
   return queryOptions({
      queryKey: ipcQueryKey(sharedContentTargetIpc.getOverview, targetId),
      queryFn: () => window.encore.sharedContent.getOverview({ targetId }),
      refetchOnMount: 'always'
   });
}

export function useSharedContentEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.sharedContent.onSnapshot(({ targetId, snapshot }) => {
         setExistingQueryData(queryClient, sharedContentListQueryOptions({ targetId, installId: snapshot.installId }).queryKey, {
            targetId,
            status: 'ok',
            value: snapshot
         });
         void queryClient.invalidateQueries({ queryKey: ipcQueryKey(sharedContentTargetIpc.getOverview, targetId) });
      });
   }, [queryClient]);
}
