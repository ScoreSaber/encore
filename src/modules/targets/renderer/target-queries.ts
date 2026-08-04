import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { ipcQueryKey, setExistingQueryData } from '@/app/renderer/query/utils';
import type { Target } from '@/modules/targets/contract';
import { targetsIpc } from '@/modules/targets/ipc';

export const targetListQueryOptions = queryOptions({
   queryKey: ipcQueryKey(targetsIpc.list),
   queryFn: () => window.encore.targets.list()
});

export function useTargetEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      const unsubscribeTargets = window.encore.targets.onEvent((event) => {
         setExistingQueryData<Target[]>(queryClient, targetListQueryOptions.queryKey, (current) => {
            const targets = current ?? [];
            if (event.type === 'target-removed') return targets.filter((target) => target.id !== event.targetId);

            const known = targets.some((target) => target.id === event.target.id);
            return known ? targets.map((target) => (target.id === event.target.id ? event.target : target)) : [...targets, event.target];
         });
      });

      return () => {
         unsubscribeTargets();
      };
   }, [queryClient]);
}
