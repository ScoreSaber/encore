import { queryOptions } from '@tanstack/react-query';

import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import type { TargetId } from '@/modules/targets/contract';
import { installKey, snapshotGcTime, targetKey, targetQuery } from '@/renderer/query/api-query';

export function sharedContentListQueryOptions(request: TargetSharedContentRequest) {
   return queryOptions({
      ...targetQuery(installKey('sharedContent', request, 'list'), () => window.encore.sharedContent.list(request)),
      gcTime: snapshotGcTime
   });
}

export function sharedContentOverviewQueryOptions(targetId: TargetId) {
   return queryOptions({
      ...targetQuery(targetKey('sharedContent', targetId, 'getOverview'), () => window.encore.sharedContent.getOverview({ targetId })),
      refetchOnMount: 'always'
   });
}
