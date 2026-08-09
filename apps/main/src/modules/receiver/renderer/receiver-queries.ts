import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { receiverIpc } from '@/modules/receiver/ipc';
import { setExistingQueryData } from '@/renderer/query/utils';
import { ipcQueryKey } from '@/renderer/query/utils';

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
