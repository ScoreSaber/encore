import { useCallback, useState } from 'react';

import type { IpcError, IpcResult } from '@/app/ipc/core';
import { inlineIpcResult, inlineTargetIpcResult } from '@/app/renderer/ipc-result';
import type { TargetCallResult } from '@/lib/api';
import type { OperationId, OperationSnapshot } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import type { TargetId } from '@/modules/targets/contract';

type ContentActionKind<OtherKind extends string> = 'delete' | OtherKind;
type ContentActionError = Pick<IpcError, 'code' | 'message'>;

export type ContentActionState<OtherKind extends string, Problem, Preview, Selection> =
   | { status: 'idle' }
   | { status: 'previewing'; kind: ContentActionKind<OtherKind> }
   | { status: 'invalid'; kind: ContentActionKind<OtherKind>; problem: Problem }
   | { status: 'ready' | 'starting'; kind: 'delete'; preview: Preview; selection: Selection }
   | { status: 'running'; kind: ContentActionKind<OtherKind>; operationId: OperationId; preview: Preview | null }
   | { status: 'failed'; kind: ContentActionKind<OtherKind>; error: IpcError };

export function useContentActions<OtherKind extends string, Problem, Preview, Selection>(
   targetId: TargetId,
   startError: ContentActionError,
   deleteError: ContentActionError,
   onFinished?: () => void
) {
   const { operations, cancelOperation } = useOperations(targetId);
   const [state, setState] = useState<ContentActionState<OtherKind, Problem, Preview, Selection>>({ status: 'idle' });
   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;
   const { code: startErrorCode, message: startErrorMessage } = startError;
   const { code: deleteErrorCode, message: deleteErrorMessage } = deleteError;

   const start = useCallback(
      async (kind: ContentActionKind<OtherKind>, run: () => Promise<IpcResult<OperationSnapshot>>) => {
         setState({ status: 'previewing', kind });

         const started = await inlineIpcResult(run, { code: startErrorCode, message: startErrorMessage });
         setState(
            started.ok ? { status: 'running', kind, operationId: started.value.id, preview: null } : { status: 'failed', kind, error: started.error }
         );
      },
      [startErrorCode, startErrorMessage]
   );

   const startTarget = useCallback(
      async (kind: ContentActionKind<OtherKind>, run: () => Promise<TargetCallResult<IpcResult<OperationSnapshot>>>) => {
         setState({ status: 'previewing', kind });

         const started = await inlineTargetIpcResult(run, { code: startErrorCode, message: startErrorMessage });
         setState(
            started.ok ? { status: 'running', kind, operationId: started.value.id, preview: null } : { status: 'failed', kind, error: started.error }
         );
      },
      [startErrorCode, startErrorMessage]
   );

   const confirmTargetDelete = useCallback(
      async (run: (selection: Selection, preview: Preview) => Promise<TargetCallResult<IpcResult<OperationSnapshot>>>) => {
         if (state.status !== 'ready') return;

         const { preview, selection } = state;
         setState({ status: 'starting', kind: 'delete', preview, selection });

         const started = await inlineTargetIpcResult(() => run(selection, preview), { code: deleteErrorCode, message: deleteErrorMessage });
         setState(
            started.ok
               ? { status: 'running', kind: 'delete', operationId: started.value.id, preview }
               : { status: 'failed', kind: 'delete', error: started.error }
         );
      },
      [deleteErrorCode, deleteErrorMessage, state]
   );

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => {
      setState({ status: 'idle' });
      onFinished?.();
   }, [onFinished]);

   return { state, setState, operation, start, startTarget, confirmTargetDelete, cancel, dismiss };
}
