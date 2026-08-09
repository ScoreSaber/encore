import { useEffect, useRef } from 'react';

import { useQuery } from '@tanstack/react-query';

import { modRepositoryListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import { localTargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

export function useRepositorySync() {
   const repositories = useQuery(modRepositoryListQueryOptions);
   const { targets } = useTargets();
   const synced = useRef(new Map<string, string>());

   useEffect(() => {
      if (!repositories.data) return;

      const input = {
         officialEnabled: repositories.data.official.every((source) => source.enabled),
         repositories: repositories.data.repositories.map((repository) => ({ listingUrl: repository.listingUrl, enabled: repository.enabled })),
         resolution: repositories.data.resolution
      };
      const signature = JSON.stringify(input);
      const eligible = targets.filter(
         (target) => target.id !== localTargetId && target.status === 'ready' && target.capabilities.includes('manage-mods')
      );
      const eligibleIds = new Set(eligible.map((target) => target.id));
      for (const targetId of synced.current.keys()) {
         if (!eligibleIds.has(targetId)) synced.current.delete(targetId);
      }

      for (const target of eligible) {
         if (synced.current.get(target.id) === signature) continue;

         synced.current.set(target.id, signature);
         void window.encore.mods.syncRepositories({ targetId: target.id, ...input }).then(
            (result) => {
               if (result.status !== 'ok' || result.value.failures.length > 0) synced.current.delete(target.id);
            },
            () => synced.current.delete(target.id)
         );
      }
   }, [repositories.data, targets]);
}
