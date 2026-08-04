import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/app/ipc/target-api';
import { ipcQueryKey, setExistingQueryData } from '@/app/renderer/query/utils';
import { installsApi } from '@/modules/installs/api';
import type { InstallDetailRequest } from '@/modules/installs/contract';
import type { TargetId } from '@/modules/targets/contract';

const installsIpc = createTargetIpcDescriptor(installsApi);

export function installListQueryOptions(targetId: TargetId) {
   return queryOptions({
      queryKey: ipcQueryKey(installsIpc.list, targetId),
      queryFn: async () => {
         const response = await window.encore.installs.list({ targetId });
         return response.status === 'ok' ? { ...response.value, targetId: response.targetId } : null;
      }
   });
}

export function installDetailQueryOptions(request: InstallDetailRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(installsIpc.getDetail, request.targetId, request.installId),
      queryFn: async () => {
         const response = await window.encore.installs.getDetail(request);
         return response.status === 'ok' ? response.value : null;
      }
   });
}

export function useInstallEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.installs.onSnapshot(({ targetId, snapshot }) => {
         setExistingQueryData(queryClient, installListQueryOptions(targetId).queryKey, { ...snapshot, targetId });
         void queryClient.invalidateQueries({ queryKey: ipcQueryKey(installsIpc.getDetail, targetId) });
      });
   }, [queryClient]);
}
