import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { setExistingQueryData } from '@/app/renderer/query/utils';
import { ipcQueryKey } from '@/app/renderer/query/utils';
import { updatesIpc } from '@/modules/updates/ipc';

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
