import { useQuery, useQueryClient } from '@tanstack/react-query';

import { installListQueryOptions } from '@/modules/installs/renderer/queries';
import type { TargetId } from '@/modules/targets/contract';
import { unwrapIpc, unwrapTarget } from '@/renderer/ipc-result';
import { queryStatus, useSnapshotMutation } from '@/renderer/query/api-query';

export function useInstalls(targetId: TargetId) {
   const queryClient = useQueryClient();
   const { queryKey } = installListQueryOptions(targetId);
   const query = useQuery(installListQueryOptions(targetId));
   const installs = window.encore.installs;
   const rescan = useSnapshotMutation(queryKey, async () => unwrapTarget(await installs.rescan({ targetId })));
   const setPinned = useSnapshotMutation(queryKey, async ({ installId, pinned }: { installId: string; pinned: boolean }) =>
      unwrapIpc(unwrapTarget(await installs.setPinned({ targetId, installId, pinned })))
   );
   const reorder = useSnapshotMutation(queryKey, async (installIds: string[]) =>
      unwrapIpc(unwrapTarget(await installs.reorder({ targetId, installIds })))
   );

   return {
      snapshot: query.data ?? null,
      loadStatus: queryStatus(query),
      scanStatus: rescan.isPending ? 'scanning' : 'idle',
      organising: setPinned.isPending || reorder.isPending,
      reload: () => queryClient.invalidateQueries({ queryKey }),
      setPinned: (installId: string, pinned: boolean) => setPinned.mutate({ installId, pinned }),
      reorder: (installIds: string[]) => reorder.mutate(installIds),
      rescan: () =>
         rescan.mutateAsync().then(
            () => undefined,
            () => undefined
         )
   };
}
