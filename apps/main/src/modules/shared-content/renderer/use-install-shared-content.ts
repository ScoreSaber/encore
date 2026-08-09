import { useQuery } from '@tanstack/react-query';

import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import { createEmptySharedContentSnapshot } from '@/modules/shared-content/contract';
import { sharedContentListQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import { useSnapshotMutation } from '@/renderer/query/use-snapshot-mutation';

export function useInstallSharedContent(request: TargetSharedContentRequest) {
   const query = useQuery(sharedContentListQueryOptions(request));
   const rescanSharedContent = useSnapshotMutation({
      queryKey: sharedContentListQueryOptions(request).queryKey,
      run: () => window.encore.sharedContent.rescan(request)
   });

   const snapshot = query.data?.status === 'ok' ? query.data.value : createEmptySharedContentSnapshot(request);
   const status = query.isError ? 'error' : query.isPending || rescanSharedContent.isPending ? 'loading' : 'ready';

   return { snapshot, status, rescan: () => rescanSharedContent.mutate() };
}
