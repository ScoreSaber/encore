import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { InstallActionRequest } from '@/modules/installs/contract';
import type { LaunchOptions } from '@/modules/launch/contract';
import type { TargetId } from '@/modules/targets/contract';
import { installKey, targetKey, targetQuery } from '@/renderer/query/api-query';

export function launchStateQueryOptions(targetId: TargetId) {
   return queryOptions({
      ...targetQuery(targetKey('launch', targetId, 'getState'), () => window.encore.launch.getState({ targetId })),
      refetchInterval: (query) => (query.state.data?.platform === 'quest' ? 5_000 : false)
   });
}

export function launchOptionsQueryOptions(request: InstallActionRequest) {
   return queryOptions({
      ...targetQuery(installKey('launch', request, 'getOptions'), () => window.encore.launch.getOptions(request)),
      staleTime: Infinity
   });
}

export function launchPreviewQueryOptions(request: InstallActionRequest, options: LaunchOptions) {
   return queryOptions({
      ...targetQuery(installKey('launch', request, 'preview', JSON.stringify(options)), () => window.encore.launch.preview({ ...request, options })),
      placeholderData: keepPreviousData,
      staleTime: 0
   });
}
