import { queryOptions } from '@tanstack/react-query';

import type { TargetId } from '@/modules/targets/contract';
import { targetKey, targetQuery } from '@/renderer/query/api-query';

export function questStateQueryOptions(targetId: TargetId) {
   return queryOptions(targetQuery(targetKey('quest', targetId, 'getState'), () => window.encore.quest.getState({ targetId })));
}
