import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import type { TargetId } from '@/modules/targets/contract';

export function useInstalls(targetId: TargetId) {
   const queryClient = useQueryClient();
   const listOptions = installListQueryOptions(targetId);
   const query = useQuery(listOptions);
   const rescanInstalls = useSnapshotMutation({
      queryKey: listOptions.queryKey,
      run: () => window.encore.installs.rescan({ targetId }),
      snapshot: (response) => (response.status === 'ok' ? { ...response.value, targetId: response.targetId } : undefined)
   });
   const setPinned = useSnapshotMutation({
      queryKey: listOptions.queryKey,
      run: ({ installId, pinned }: { installId: string; pinned: boolean }) => window.encore.installs.setPinned({ targetId, installId, pinned }),
      snapshot: (response) => (response.status === 'ok' && response.value.ok ? { ...response.value.value, targetId: response.targetId } : undefined)
   });
   const reorder = useSnapshotMutation({
      queryKey: listOptions.queryKey,
      run: (installIds: string[]) => window.encore.installs.reorder({ targetId, installIds }),
      snapshot: (response) => (response.status === 'ok' && response.value.ok ? { ...response.value.value, targetId: response.targetId } : undefined)
   });

   const loadStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

   return {
      snapshot: query.data ?? null,
      loadStatus,
      scanStatus: rescanInstalls.isPending ? 'scanning' : 'idle',
      organising: setPinned.isPending || reorder.isPending,
      reload: () => void queryClient.invalidateQueries({ queryKey: listOptions.queryKey }),
      setPinned: (installId: string, pinned: boolean) => setPinned.mutate({ installId, pinned }),
      reorder: (installIds: string[]) => reorder.mutate(installIds),
      rescan: () =>
         rescanInstalls.mutateAsync().then(
            () => undefined,
            () => undefined
         )
   };
}
