import { useCallback, useState } from 'react';

import { queryOptions, useQuery } from '@tanstack/react-query';

import type { IpcError } from '@/app/ipc/core';
import { inlineIpcResult } from '@/app/renderer/ipc-result';
import { ipcQueryKey } from '@/app/renderer/query/utils';
import { type BSManagerAdoptionOutcome, type BSManagerPlan, type BSManagerPlanProblem, type ReadyBSManagerPlan } from '@/modules/bsmanager/contract';
import { bsmanagerIpc } from '@/modules/bsmanager/ipc';
import type { TargetId } from '@/modules/targets/contract';

type BSManagerAdoptionState =
   | { status: 'idle' }
   | { status: 'loading' }
   | { status: 'invalid'; plan: BSManagerPlanProblem }
   | { status: 'ready'; plan: ReadyBSManagerPlan }
   | { status: 'adopting'; plan: ReadyBSManagerPlan }
   | { status: 'adopted'; plan: ReadyBSManagerPlan; outcome: BSManagerAdoptionOutcome }
   | { status: 'failed'; error: IpcError };

export type BSManagerAdopter = ReturnType<typeof useBSManagerAdoption>;

function bsmanagerDetectionQueryOptions(targetId: TargetId) {
   return queryOptions({
      queryKey: ipcQueryKey(bsmanagerIpc.detectBSManager, targetId),
      queryFn: () => window.encore.bsmanager.detectBSManager({ targetId })
   });
}

export function useBSManagerAdoption(targetId: TargetId) {
   const bsmanager = window.encore.bsmanager;
   const detected = useQuery(bsmanagerDetectionQueryOptions(targetId));
   const [state, setState] = useState<BSManagerAdoptionState>({ status: 'idle' });
   const [selected, setSelected] = useState<string[]>([]);
   const [shareContent, setShareContent] = useState(true);

   const detection = detected.data ?? null;

   const applyPlan = useCallback((plan: BSManagerPlan) => {
      if (plan.status === 'invalid') {
         setState({ status: 'invalid', plan });
         return;
      }

      setSelected(plan.versions.filter((version) => version.status === 'ready').map((version) => version.id));
      setShareContent(!plan.sharedRootAdopted);
      setState({ status: 'ready', plan });
   }, []);

   const open = useCallback(async () => {
      setState({ status: 'loading' });
      const plan = await bsmanager.planBSManagerAdoption({ targetId }).catch(() => null);

      if (!plan) {
         setState({ status: 'failed', error: { code: 'bsmanager.plan-failed', message: 'the BSManager folder could not be read' } });
         return;
      }

      applyPlan(plan);
   }, [applyPlan, bsmanager, targetId]);

   const toggleVersion = useCallback((versionId: string, next: boolean) => {
      setSelected((current) => (next ? [...new Set([...current, versionId])] : current.filter((entry) => entry !== versionId)));
   }, []);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const plan = state.plan;
      setState({ status: 'adopting', plan });

      const adopted = await inlineIpcResult(
         () => bsmanager.adoptBSManager({ targetId, rootPath: plan.rootPath, versionIds: selected, adoptSharedRoot: shareContent }),
         { code: 'bsmanager.adopt-failed', message: 'the versions could not be registered' }
      );

      setState(adopted.ok ? { status: 'adopted', plan, outcome: adopted.value } : { status: 'failed', error: adopted.error });
   }, [bsmanager, selected, shareContent, state, targetId]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);
   return {
      detection,
      state,
      selected,
      shareContent,
      setShareContent,
      open,
      toggleVersion,
      confirm,
      dismiss
   };
}
