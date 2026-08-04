import { useCallback } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { targetListQueryOptions } from '@/modules/targets/renderer/target-queries';

export type TargetsLoadStatus = 'error' | 'loading' | 'ready';

export function useTargets() {
   const queryClient = useQueryClient();
   const query = useQuery(targetListQueryOptions);

   const reload = useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: targetListQueryOptions.queryKey });
   }, [queryClient]);

   const status: TargetsLoadStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

   return {
      status,
      targets: query.data ?? [],
      reload
   };
}
