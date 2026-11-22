import { queryOptions } from '@tanstack/react-query';

import type { Target, TargetEvent } from '@/modules/targets/contract';
import { apiKey } from '@/renderer/query/api-query';

export const targetListQueryOptions = queryOptions({
   queryKey: apiKey('targets', 'list'),
   queryFn: () => window.encore.targets.list()
});

export function applyTargetEvent(targets: Target[], event: TargetEvent) {
   if (event.type === 'target-removed') return targets.filter((target) => target.id !== event.targetId);

   const known = targets.some((target) => target.id === event.target.id);
   return known ? targets.map((target) => (target.id === event.target.id ? event.target : target)) : [...targets, event.target];
}
