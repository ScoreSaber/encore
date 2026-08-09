import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { updatesIpc } from '@/modules/updates/ipc';
import { setExistingQueryData } from '@/renderer/query/utils';
import { ipcQueryKey } from '@/renderer/query/utils';

export const updateSnapshotQueryOptions = queryOptions({
   queryKey: ipcQueryKey(updatesIpc.getSnapshot),
   queryFn: () => window.encore.update.getSnapshot()
});

export function useUpdateEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.update.onStatus((snapshot) => {
         setExistingQueryData(queryClient, updateSnapshotQueryOptions.queryKey, snapshot);
      });
   }, [queryClient]);
}
