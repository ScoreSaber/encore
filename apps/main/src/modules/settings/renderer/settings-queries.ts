import { queryOptions } from '@tanstack/react-query';

import { apiKey } from '@/renderer/query/api-query';

export const settingsSnapshotQueryOptions = queryOptions({
   queryKey: apiKey('settings', 'getSnapshot'),
   queryFn: () => window.encore.settings.getSnapshot(),
   staleTime: Infinity
});

export const protonStateQueryOptions = queryOptions({
   queryKey: apiKey('settings', 'getProtonState'),
   queryFn: () => window.encore.settings.getProtonState()
});
