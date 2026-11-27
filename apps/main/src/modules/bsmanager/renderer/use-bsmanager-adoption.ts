import { useCallback, useEffect, useRef, useState } from 'react';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { createLatestGuard } from '@/lib/state/machine';
import { type BSManagerAdoptionOutcome, type BSManagerPlan, type BSManagerPlanProblem, type ReadyBSManagerPlan } from '@/modules/bsmanager/contract';
import type { TargetId } from '@/modules/targets/contract';
import { inlineIpcResult, unwrapTarget } from '@/renderer/ipc-result';
import { targetKey } from '@/renderer/query/api-query';

type BSManagerAdoptionState =
   | { status: 'idle' }
   | { status: 'loading' }
   | { status: 'invalid'; plan: BSManagerPlanProblem }
   | { status: 'ready'; plan: ReadyBSManagerPlan; selected: string[]; shareContent: boolean; copyPrefix: boolean }
   | { status: 'adopting'; plan: ReadyBSManagerPlan; selected: string[]; shareContent: boolean; copyPrefix: boolean }
   | {
        status: 'adopted';
        plan: ReadyBSManagerPlan;
        selected: string[];
        shareContent: boolean;
        copyPrefix: boolean;
        outcome: BSManagerAdoptionOutcome;
     }
   | { status: 'failed'; error: Problem };

export type BSManagerAdopter = ReturnType<typeof useBSManagerAdoption>;

function bsmanagerDetectionQueryOptions(targetId: TargetId) {
   return queryOptions({
      queryKey: targetKey('bsmanager', targetId, 'detect'),
      queryFn: async () => {
         const detected = await window.encore.bsmanager.detect({ targetId });
         return detected.status === 'ok' ? detected.value : null;
      }
   });
}

export function useBSManagerAdoption(targetId: TargetId) {
   const bsmanager = window.encore.bsmanager;
   const detected = useQuery(bsmanagerDetectionQueryOptions(targetId));
   const [scoped, setScoped] = useState<{ targetId: TargetId; state: BSManagerAdoptionState }>({
      targetId,
      state: { status: 'idle' }
   });
   const activeTarget = useRef(targetId);
   const guard = useRef(createLatestGuard());

   useEffect(() => {
      if (activeTarget.current === targetId) return;

      activeTarget.current = targetId;
      guard.current.invalidate();
      setScoped({ targetId, state: { status: 'idle' } });
   }, [targetId]);

   const state: BSManagerAdoptionState = scoped.targetId === targetId ? scoped.state : { status: 'idle' };
   const selected = state.status === 'ready' || state.status === 'adopting' || state.status === 'adopted' ? state.selected : [];
   const shareContent = state.status === 'ready' || state.status === 'adopting' || state.status === 'adopted' ? state.shareContent : true;
   let action: 'add' | 'copyPrefixAction' | 'replacePrefixAction' = selected.length > 0 ? 'add' : 'copyPrefixAction';
   if ((state.status === 'ready' || state.status === 'adopting') && state.copyPrefix && state.plan.existingPrefix) action = 'replacePrefixAction';
   const detection = detected.data ?? null;

   const applyPlan = useCallback((destination: TargetId, plan: BSManagerPlan) => {
      if (plan.status === 'invalid') {
         setScoped({ targetId: destination, state: { status: 'invalid', plan } });
         return;
      }

      setScoped({
         targetId: destination,
         state: {
            status: 'ready',
            plan,
            selected: plan.versions.filter((version) => version.status === 'ready').map((version) => version.id),
            shareContent: !plan.sharedRootAdopted,
            copyPrefix: false
         }
      });
   }, []);

   const open = useCallback(async () => {
      const token = guard.current.next();
      const destination = targetId;
      setScoped({ targetId: destination, state: { status: 'loading' } });
      const plan = await Result.tryPromise({
         try: async () => unwrapTarget(await bsmanager.plan({ targetId: destination })),
         catch: (cause) => createProblem('bsmanager.plan-failed', { cause })
      });
      if (!guard.current.isCurrent(token) || activeTarget.current !== destination) return;
      if (Result.isError(plan)) {
         setScoped({ targetId: destination, state: { status: 'failed', error: plan.error } });
         return;
      }

      applyPlan(destination, plan.value);
   }, [applyPlan, bsmanager, targetId]);

   const toggleVersion = useCallback(
      (versionId: string, next: boolean) => {
         setScoped((current) => {
            if (current.targetId !== targetId || current.state.status !== 'ready') return current;

            const updated = next
               ? [...new Set([...current.state.selected, versionId])]
               : current.state.selected.filter((entry) => entry !== versionId);
            return { targetId, state: { ...current.state, selected: updated } };
         });
      },
      [targetId]
   );

   const setOption = useCallback(
      (option: 'shareContent' | 'copyPrefix', next: boolean) => {
         setScoped((current) => {
            if (current.targetId !== targetId || current.state.status !== 'ready') return current;
            return { targetId, state: { ...current.state, [option]: next } };
         });
      },
      [targetId]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const token = guard.current.next();
      const destination = targetId;
      const { plan, selected: versionIds, shareContent: adoptSharedRoot, copyPrefix } = state;
      setScoped({ targetId: destination, state: { ...state, status: 'adopting' } });

      const adopted = await inlineIpcResult(
         () =>
            bsmanager.adopt({
               targetId: destination,
               rootPath: plan.rootPath,
               versionIds,
               adoptSharedRoot: versionIds.length > 0 && adoptSharedRoot,
               copyPrefix,
               replacePrefix: copyPrefix && plan.existingPrefix
            }),
         createProblem('bsmanager.adopt-failed')
      );
      if (!guard.current.isCurrent(token) || activeTarget.current !== destination) return;

      setScoped({
         targetId: destination,
         state: adopted.ok ? { ...state, status: 'adopted', outcome: adopted.value } : { status: 'failed', error: adopted.error }
      });
   }, [bsmanager, state, targetId]);

   const dismiss = useCallback(() => {
      guard.current.invalidate();
      setScoped({ targetId, state: { status: 'idle' } });
   }, [targetId]);

   return {
      detection,
      action,
      state,
      selected,
      shareContent,
      setOption,
      open,
      toggleVersion,
      confirm,
      dismiss
   };
}
