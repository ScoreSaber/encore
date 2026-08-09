import { queryOptions } from '@tanstack/react-query';

import { shortcutsIpc } from '@/modules/shortcuts/ipc';
import { ipcQueryKey } from '@/renderer/query/utils';

export const shortcutStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(shortcutsIpc.getState),
   queryFn: () => window.encore.shortcuts.getState()
});
