import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { setExistingQueryData } from '@/app/renderer/query/utils';
import { ipcQueryKey } from '@/app/renderer/query/utils';
import { receiverIpc } from '@/modules/receiver/ipc';

export const receiverStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(receiverIpc.getState),
   queryFn: () => window.encore.receiver.getState()
});

export function useReceiverEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.receiver.onStateChanged((state) => {
         setExistingQueryData(queryClient, receiverStateQueryOptions.queryKey, state);
      });
   }, [queryClient]);
}
