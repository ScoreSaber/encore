import { queryOptions } from '@tanstack/react-query';

import { apiKey } from '@/renderer/query/api-query';

export const appInfoQueryOptions = queryOptions({
   queryKey: apiKey('app', 'getInfo'),
   queryFn: () => window.encore.app.getInfo(),
   staleTime: Infinity
});
