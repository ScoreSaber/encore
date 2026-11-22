import { useQuery } from '@tanstack/react-query';

import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import { createEmptySharedContentSnapshot } from '@/modules/shared-content/contract';
import { sharedContentListQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import { queryStatus } from '@/renderer/query/api-query';

export function useInstallSharedContent(request: TargetSharedContentRequest) {
   const query = useQuery(sharedContentListQueryOptions(request));
   const status = queryStatus(query);
   const snapshot = query.data ?? createEmptySharedContentSnapshot(request, status === 'unsupported' ? 'unsupported' : 'missing');

   return { snapshot, status };
}
