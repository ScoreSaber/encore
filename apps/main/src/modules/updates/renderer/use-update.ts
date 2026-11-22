import { queryOptions, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'use-intl';

import type { TargetId } from '@/modules/targets/contract';
import { encoreReleasesUrl, type UpdateState } from '@/modules/updates/contract';
import { unwrapTarget } from '@/renderer/ipc-result';
import { targetKey, targetQuery, useSnapshotMutation } from '@/renderer/query/api-query';

type UpdateCall = 'check' | 'download' | 'install' | 'update';

type UpdateAction = Exclude<UpdateCall, 'update'> | 'open-release' | 'none';

export function updateStateQueryOptions(targetId: TargetId) {
   return queryOptions(targetQuery(targetKey('updates', targetId, 'getState'), () => window.encore.updates.getState({ targetId })));
}

function updateAction(state: UpdateState | null): UpdateAction {
   if (!state) return 'none';
   if (state.status === 'downloaded') return 'install';
   if (state.status === 'available') return state.selfUpdates ? 'download' : 'open-release';
   if (state.status === 'disabled' || state.status === 'checking' || state.status === 'downloading') return 'none';

   return 'check';
}

export function useUpdate(targetId: TargetId, enabled = true) {
   const t = useTranslations('updates');
   const options = updateStateQueryOptions(targetId);
   const query = useQuery({ ...options, enabled });
   const call = useSnapshotMutation(options.queryKey, async (method: UpdateCall) => unwrapTarget(await window.encore.updates[method]({ targetId })));
   const state = query.data ?? null;

   function openRelease(version: string | null) {
      void window.encore.app.openLink({ url: version ? `${encoreReleasesUrl}/tag/v${encodeURIComponent(version)}` : encoreReleasesUrl });
   }

   function run(method: UpdateCall) {
      call.mutate(method, {
         onSuccess: (next) => {
            if (next.errorContext && next.message) {
               toast.error(t(`failed.${next.errorContext}`), { description: next.message });
               return;
            }
            if (method !== 'download' || next.status !== 'downloaded') return;

            toast.success(t('downloadedToast.title'), {
               description: t('downloadedToast.description'),
               action: { label: t('releaseNotes'), onClick: () => openRelease(next.downloadedVersion) }
            });
         },
         onError: (error) => {
            const context = method === 'check' || method === 'download' ? method : method === 'update' ? 'download' : 'install';
            toast.error(t(`failed.${context}`), { description: error.message });
         }
      });
   }

   return {
      state,
      action: updateAction(state),
      pending: call.isPending,
      pendingMethod: call.isPending ? (call.variables ?? null) : null,
      run,
      openRelease
   };
}
