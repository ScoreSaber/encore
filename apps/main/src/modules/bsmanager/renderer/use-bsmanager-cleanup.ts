import { useCallback } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { BSManagerVersion } from '@/modules/bsmanager/contract';
import { useOperationFlow, type OperationFlowState } from '@/modules/operations/renderer/use-operation-flow';
import type { TargetId } from '@/modules/targets/contract';
import { targetKey } from '@/renderer/query/api-query';

type CleanupReady = {
   kind: 'cleanup';
   rootPath: string;
   sharedContentPath: string;
   affectedVersions: BSManagerVersion[];
};

export type BSManagerCleanup = ReturnType<typeof useBSManagerCleanup>;

export function useBSManagerCleanup(targetId: TargetId, onChanged: () => void) {
   const bsmanager = window.encore.bsmanager;
   const planned = useQuery({
      queryKey: targetKey('bsmanager', targetId, 'plan'),
      queryFn: async () => {
         const planned = await bsmanager.plan({ targetId });
         return planned.status === 'ok' ? planned.value : null;
      }
   });
   const { refetch } = planned;
   const onDismiss = useCallback(
      (state: OperationFlowState<CleanupReady, never>) => {
         if (state.status !== 'running') return;
         void refetch();
         onChanged();
      },
      [onChanged, refetch]
   );
   const flow = useOperationFlow<CleanupReady>(targetId, onDismiss);
   const plan = planned.data && planned.data.status === 'ok' ? planned.data : null;
   const affectedVersions = plan?.versions.filter((version) => version.folders.some((folder) => folder.state === 'foreign')) ?? [];

   const open = useCallback(() => {
      if (!plan) return;

      flow.settle({
         status: 'ready',
         kind: 'cleanup',
         rootPath: plan.rootPath,
         sharedContentPath: plan.sharedContentPath,
         affectedVersions
      });
   }, [affectedVersions, flow.settle, plan]);

   const confirm = useCallback(
      (ready: CleanupReady) =>
         void flow.start(ready, () => bsmanager.cleanup({ targetId, rootPath: ready.rootPath }), {
            code: 'bsmanager.cleanup-failed',
            message: 'the BSManager links could not be cleaned up'
         }),
      [bsmanager, flow.start, targetId]
   );

   return { flow, plan, affectedVersions, available: affectedVersions.some((version) => version.status === 'adopted'), open, confirm };
}
