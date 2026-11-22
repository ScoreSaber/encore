import { useEffect, useRef } from 'react';

import { useQuery } from '@tanstack/react-query';

import { officialModSourceId, questModSourceId, type ModRepositorySyncRequest } from '@/modules/mods/contract';
import { modRepositoryListQueryOptions } from '@/modules/mods/renderer/mod-queries';
import type { TargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type SyncPayload = {
   input: ModRepositorySyncRequest;
   signature: string;
};

type TargetSyncState =
   | { status: 'synced'; signature: string }
   | { status: 'syncing'; signature: string; pending: SyncPayload | null }
   | { status: 'failed'; signature: string };

export function useRepositorySync() {
   const repositories = useQuery(modRepositoryListQueryOptions);
   const { targets } = useTargets();
   const statesRef = useRef(new Map<TargetId, TargetSyncState>());

   useEffect(() => {
      if (!repositories.data) return;

      const states = statesRef.current;
      const eligible = targets.filter(
         (target) => (target.kind === 'remote' || target.via) && target.status === 'ready' && target.capabilities.includes('manage-mods')
      );
      const eligibleIds = new Set(eligible.map((target) => target.id));
      for (const targetId of states.keys()) {
         if (!eligibleIds.has(targetId)) states.delete(targetId);
      }

      const startSync = (targetId: TargetId, payload: SyncPayload) => {
         states.set(targetId, { status: 'syncing', signature: payload.signature, pending: null });
         void window.encore.mods.syncRepositories({ targetId, ...payload.input }).then(
            (result) => finishSync(targetId, payload.signature, result.status === 'ok' && result.value.failures.length === 0),
            () => finishSync(targetId, payload.signature, false)
         );
      };

      const finishSync = (targetId: TargetId, signature: string, ok: boolean) => {
         const current = states.get(targetId);
         if (!current || current.status !== 'syncing' || current.signature !== signature) return;

         if (current.pending) {
            startSync(targetId, current.pending);
            return;
         }

         states.set(targetId, { status: ok ? 'synced' : 'failed', signature });
      };

      for (const target of eligible) {
         const input: ModRepositorySyncRequest = {
            official: repositories.data.official
               .filter((source) => source.id !== (target.capabilities.includes('patch-game') ? officialModSourceId : questModSourceId))
               .map(({ id, enabled }) => ({ id, enabled })),
            repositories: repositories.data.repositories.map((repository) => ({ listingUrl: repository.listingUrl, enabled: repository.enabled })),
            resolution: repositories.data.resolution
         };
         const signature = JSON.stringify(input);
         const current = states.get(target.id);

         if (current?.status === 'synced' && current.signature === signature) continue;
         if (current?.status === 'syncing') {
            if (current.signature === signature) current.pending = null;
            else current.pending = { input, signature };
            continue;
         }

         startSync(target.id, { input, signature });
      }
   }, [repositories.data, targets]);
}
