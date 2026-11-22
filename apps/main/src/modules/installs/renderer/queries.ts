import { queryOptions } from '@tanstack/react-query';

import type { InstallDetailRequest } from '@/modules/installs/contract';
import type { TargetId } from '@/modules/targets/contract';
import { installKey, targetKey, targetQuery } from '@/renderer/query/api-query';

export function installListQueryOptions(targetId: TargetId) {
   return queryOptions(targetQuery(targetKey('installs', targetId, 'list'), () => window.encore.installs.list({ targetId })));
}

export function installDetailQueryOptions(request: InstallDetailRequest) {
   return queryOptions(targetQuery(installKey('installs', request, 'getDetail'), () => window.encore.installs.getDetail(request)));
}
