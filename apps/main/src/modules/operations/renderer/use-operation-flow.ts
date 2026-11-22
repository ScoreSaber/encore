import { useCallback, useEffect, useRef, useState } from 'react';

import { Result } from 'better-result';

import type { IpcResult } from '@/ipc/core';
import type { TargetCallResult } from '@/lib/api';
import type { Problem } from '@/lib/errors';
import { isOperationTerminalStatus, type OperationId } from '@/modules/operations/contract';
import { useOperations, useTrackedOperation } from '@/modules/operations/renderer/use-operations';
import type { TargetId } from '@/modules/targets/contract';
import { inlineIpcResult } from '@/renderer/ipc-result';

type Flowing = { kind: string };
type Started = IpcResult<{ id: OperationId }> | TargetCallResult<IpcResult<{ id: OperationId }>>;

export type OperationFlowState<Ready extends Flowing, Invalid> =
   | { status: 'idle' }
   | { status: 'choosing'; kind: Ready['kind'] }
   | { status: 'previewing'; kind: Ready['kind'] }
   | { status: 'invalid'; kind: Ready['kind']; problem: Invalid }
   | ({ status: 'ready' | 'repreviewing' | 'starting' | 'submitting' } & Ready)
   | ({ status: 'running'; operationId: OperationId; startedAt: number } & Ready)
   | { status: 'failed'; kind: Ready['kind']; error: Problem };

type Previewed<Ready extends Flowing, Invalid> = ({ status: 'ready' } & Ready) | { status: 'invalid'; kind: Ready['kind']; problem: Invalid };

export type OperationFlowDismissOutcome = { completed: boolean };

export type OperationFlow<Ready extends Flowing, Invalid = never> = ReturnType<typeof useOperationFlow<Ready, Invalid>>;

export function useOperationFlow<Ready extends Flowing, Invalid = never>(
   targetId: TargetId,
   onDismiss?: (state: OperationFlowState<Ready, Invalid>, outcome: OperationFlowDismissOutcome) => void
) {
   const { operations, cancelOperation } = useOperations(targetId);
   const [scoped, setScoped] = useState<{ targetId: TargetId; state: OperationFlowState<Ready, Invalid> }>({
      targetId,
      state: { status: 'idle' }
   });
   const state: OperationFlowState<Ready, Invalid> = scoped.targetId === targetId ? scoped.state : { status: 'idle' };
   const activeTarget = useRef(targetId);
   const invocation = useRef(0);

   useEffect(() => {
      if (activeTarget.current === targetId) return;

      activeTarget.current = targetId;
      invocation.current += 1;
      setScoped({ targetId, state: { status: 'idle' } });
   }, [targetId]);

   const { operation, missing } = useTrackedOperation(
      operations,
      state.status === 'running' ? state.operationId : null,
      state.status === 'running' ? state.startedAt : 0
   );
   const finished = operation !== null && isOperationTerminalStatus(operation.status);
   const completed = state.status === 'running' && operation?.status === 'completed';
   const cancelable = state.status === 'running' && operation !== null && !finished && !missing && operation.cancelable;
   const busy =
      state.status === 'choosing' ||
      state.status === 'starting' ||
      state.status === 'submitting' ||
      (state.status === 'running' && !finished && !missing);

   const begin = useCallback(
      (next: OperationFlowState<Ready, Invalid>) => {
         const startedTarget = targetId;
         invocation.current += 1;
         const current = invocation.current;
         setScoped({ targetId: startedTarget, state: next });

         return (settled: OperationFlowState<Ready, Invalid>) => {
            if (current === invocation.current && activeTarget.current === startedTarget) {
               setScoped({ targetId: startedTarget, state: settled });
            }
         };
      },
      [targetId]
   );

   const settle = useCallback((previewed: Previewed<Ready, Invalid>) => void begin(previewed), [begin]);

   const fail = useCallback((kind: Ready['kind'], error: Problem) => void begin({ status: 'failed', kind, error }), [begin]);

   const choose = useCallback(
      async <Choice>(
         kind: Ready['kind'],
         pick: () => Promise<Choice | null>,
         onChosen: (choice: Choice) => Promise<void> | void,
         failure: Problem,
         onSuperseded?: (choice: Choice) => void
      ) => {
         const startedTarget = targetId;
         const finish = begin({ status: 'choosing', kind });
         const token = invocation.current;

         const picked = await Result.tryPromise({ try: pick, catch: () => failure });
         if (token !== invocation.current || activeTarget.current !== startedTarget) {
            if (Result.isOk(picked) && picked.value !== null) onSuperseded?.(picked.value);
            return;
         }

         if (Result.isError(picked)) {
            finish({ status: 'failed', kind, error: picked.error });
            return;
         }

         if (picked.value === null) {
            finish({ status: 'idle' });
            return;
         }

         await onChosen(picked.value);
      },
      [begin, targetId]
   );

   const preview = useCallback(
      async (kind: Ready['kind'], load: () => Promise<Previewed<Ready, Invalid>>, failure: Problem, pending?: Ready) => {
         const finish = begin(pending ? { ...pending, status: 'repreviewing' } : { status: 'previewing', kind });

         const previewed = await Result.tryPromise({ try: load, catch: () => failure });
         finish(Result.isOk(previewed) ? previewed.value : { status: 'failed', kind, error: previewed.error });
      },
      [begin]
   );

   const start = useCallback(
      async (ready: Ready, run: () => Promise<Started>, failure: Problem) => {
         const finish = begin({ ...ready, status: 'starting' });

         const started = await inlineIpcResult(run, failure);
         finish(
            started.ok
               ? { ...ready, status: 'running', operationId: started.value.id, startedAt: Date.now() }
               : { status: 'failed', kind: ready.kind, error: started.error }
         );
      },
      [begin]
   );

   const submit = useCallback(
      async <Outcome>(
         ready: Ready,
         run: () => Promise<IpcResult<Outcome> | TargetCallResult<IpcResult<Outcome>>>,
         failure: Problem,
         onSuccess?: (value: Outcome) => void
      ) => {
         const finish = begin({ ...ready, status: 'submitting' });
         const settled = await inlineIpcResult(run, failure);
         if (!settled.ok) {
            finish({ status: 'failed', kind: ready.kind, error: settled.error });
            return false;
         }

         finish({ status: 'idle' });
         onSuccess?.(settled.value);
         return true;
      },
      [begin]
   );

   const cancel = useCallback(() => {
      if (state.status === 'running' && cancelable) void cancelOperation(state.operationId);
   }, [cancelOperation, cancelable, state]);

   const dismiss = useCallback(() => {
      onDismiss?.(state, { completed });
      begin({ status: 'idle' });
   }, [begin, completed, onDismiss, state]);

   return { state, operation, missing, finished, completed, cancelable, busy, settle, fail, choose, preview, start, submit, cancel, dismiss };
}
