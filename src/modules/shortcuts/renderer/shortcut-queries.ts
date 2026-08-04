import { queryOptions } from '@tanstack/react-query';

import { ipcQueryKey } from '@/app/renderer/query/utils';
import { shortcutsIpc } from '@/modules/shortcuts/ipc';

export const shortcutStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(shortcutsIpc.getState),
   queryFn: () => window.encore.shortcuts.getState()
});
