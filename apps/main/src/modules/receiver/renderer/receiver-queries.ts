import { queryOptions } from '@tanstack/react-query';

import { apiKey } from '@/renderer/query/api-query';

export const receiverStateQueryOptions = queryOptions({
   queryKey: apiKey('receiver', 'getState'),
   queryFn: () => window.encore.receiver.getState()
});
