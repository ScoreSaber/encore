import { useCallback } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'use-intl';

import type { Target } from '@/modules/targets/contract';
import { targetListQueryOptions } from '@/modules/targets/renderer/target-queries';

export type TargetsLoadStatus = 'error' | 'loading' | 'ready';

export function useTargets() {
   const queryClient = useQueryClient();
   const query = useQuery(targetListQueryOptions);

   const reload = useCallback(() => queryClient.invalidateQueries({ queryKey: targetListQueryOptions.queryKey }), [queryClient]);

   const status: TargetsLoadStatus = query.isPending ? 'loading' : query.isError ? 'error' : 'ready';

   return {
      status,
      targets: query.data ?? [],
      reload
   };
}

export function useTargetName() {
   const t = useTranslations('targets');

   return (target: Target) => (target.via ? t('via', { name: target.name, host: target.via }) : target.name);
}
