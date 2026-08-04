import { useCallback } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import type { TargetId } from '@/modules/targets/contract';

export function useInstalls(targetId: TargetId) {
   const queryClient = useQueryClient();
   const query = useQuery(installListQueryOptions(targetId));
   const rescanInstalls = useSnapshotMutation({
      queryKey: installListQueryOptions(targetId).queryKey,
      run: () => window.encore.installs.rescan({ targetId }),
      snapshot: (response) => (response.status === 'ok' ? { ...response.value, targetId: response.targetId } : undefined)
   });

   const reload = useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: installListQueryOptions(targetId).queryKey });
   }, [queryClient, targetId]);

   const loadStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

   return {
      snapshot: query.data ?? null,
      loadStatus,
      scanStatus: rescanInstalls.isPending ? 'scanning' : 'idle',
      reload,
      rescan: () =>
         rescanInstalls.mutateAsync().then(
            () => undefined,
            () => undefined
         )
   };
}
