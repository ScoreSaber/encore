import { queryOptions } from '@tanstack/react-query';

import { settingsIpc } from '@/modules/settings/ipc';
import { ipcQueryKey } from '@/renderer/query/utils';

export const settingsSnapshotQueryOptions = queryOptions({
   queryKey: ipcQueryKey(settingsIpc.getSnapshot),
   queryFn: () => window.encore.settings.getSnapshot(),
   staleTime: Infinity
});

export const protonStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(settingsIpc.getProtonState),
   queryFn: () => window.encore.settings.getProtonState()
});
