import { useQuery } from '@tanstack/react-query';

import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import { createEmptySharedContentSnapshot } from '@/modules/shared-content/contract';
import { sharedContentListQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';

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
