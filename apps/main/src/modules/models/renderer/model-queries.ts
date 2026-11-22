import { queryOptions } from '@tanstack/react-query';

import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { apiKey, installKey, snapshotGcTime, targetQuery } from '@/renderer/query/api-query';

export function modelListQueryOptions(request: TargetModelCollectionRequest) {
   return queryOptions({
      ...targetQuery(installKey('models', request, 'list'), () => window.encore.models.list(request)),
      gcTime: snapshotGcTime
   });
}

export const modelLinkStateQueryOptions = queryOptions({
   queryKey: apiKey('models', 'getModelLinkState'),
   queryFn: () => window.encore.models.getModelLinkState()
});
