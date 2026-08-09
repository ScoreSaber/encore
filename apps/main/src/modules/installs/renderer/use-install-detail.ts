import { useCallback } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { InstallDetailRequest } from '@/modules/installs/contract';
import { installDetailQueryOptions } from '@/modules/installs/renderer/queries';

export function useInstallDetail(request: InstallDetailRequest) {
   const queryClient = useQueryClient();
   const query = useQuery(installDetailQueryOptions(request));

   const reload = useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: installDetailQueryOptions(request).queryKey });
   }, [queryClient, request]);

   const status = query.isPending ? 'loading' : query.isError ? 'error' : query.data ? 'ready' : 'missing';

   return { detail: query.data ?? null, status, reload };
}
