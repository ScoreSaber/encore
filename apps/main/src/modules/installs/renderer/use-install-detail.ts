import { useCallback } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { InstallDetailRequest } from '@/modules/installs/contract';
import { installDetailQueryOptions } from '@/modules/installs/renderer/queries';
import { queryStatus } from '@/renderer/query/api-query';

export function useInstallDetail(request: InstallDetailRequest) {
   const queryClient = useQueryClient();
   const query = useQuery(installDetailQueryOptions(request));

   const reload = useCallback(() => queryClient.invalidateQueries({ queryKey: installDetailQueryOptions(request).queryKey }), [queryClient, request]);

   const loaded = queryStatus(query);
   const status = loaded === 'ready' && !query.data ? 'missing' : loaded;

   return { detail: query.data ?? null, status, reload };
}
