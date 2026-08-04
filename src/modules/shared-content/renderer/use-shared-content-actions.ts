import { useCallback, useState } from 'react';

import type { IpcError } from '@/app/ipc/core';
import { inlineTargetIpcResult } from '@/app/renderer/ipc-result';
import type { OperationId } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import {
   defaultContentsMode,
   type ReadySharedContentPreview,
   type SharedContentAction,
   type SharedContentActionProblem,
   type SharedContentsMode,
   type SharedFolderId
} from '@/modules/shared-content/contract';

type SharedContentActionState =
   | { status: 'idle' }
   | { status: 'previewing'; action: SharedContentAction }
   | { status: 'invalid'; action: SharedContentAction; problem: SharedContentActionProblem }
   | { status: 'ready' | 'starting'; action: SharedContentAction; preview: ReadySharedContentPreview }
   | { status: 'running'; action: SharedContentAction; operationId: OperationId; preview: ReadySharedContentPreview }
   | { status: 'failed'; action: SharedContentAction; error: IpcError };

export type SharedContentActions = ReturnType<typeof useSharedContentActions>;

export function useSharedContentActions(request: TargetSharedContentRequest) {
   const sharedContent = window.encore.sharedContent;
   const { operations, cancelOperation } = useOperations(request.targetId);
   const [state, setState] = useState<SharedContentActionState>({ status: 'idle' });

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const preview = useCallback(
      async (action: SharedContentAction, folderId: SharedFolderId, contents?: SharedContentsMode, current?: ReadySharedContentPreview) => {
         const selectedContents = contents ?? defaultContentsMode(action);
         setState(current ? { status: 'ready', action, preview: { ...current, contents: selectedContents } } : { status: 'previewing', action });

         const response = await sharedContent.preview({ ...request, folderId, action, contents: selectedContents }).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({ status: 'failed', action, error: { code: 'shared-content.preview-failed', message: 'that folder could not be read' } });
            return;
         }

         const previewed = response.value;
         setState(previewed.status === 'ok' ? { status: 'ready', action, preview: previewed } : { status: 'invalid', action, problem: previewed });
      },
      [request, sharedContent]
   );

   const setContents = useCallback(
      (contents: SharedContentsMode) => {
         if (state.status !== 'ready') return;

         void preview(state.action, state.preview.folderId, contents, state.preview);
      },
      [preview, state]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const pending = state.preview;
      setState({ status: 'starting', action: state.action, preview: pending });

      const started = await inlineTargetIpcResult(
         () => sharedContent.start({ ...request, folderId: pending.folderId, action: state.action, contents: pending.contents }),
         { code: 'shared-content.start-failed', message: 'the change could not be started' }
      );

      setState(
         started.ok
            ? { status: 'running', action: state.action, operationId: started.value.id, preview: pending }
            : { status: 'failed', action: state.action, error: started.error }
      );
   }, [request, sharedContent, state]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   const openFolder = useCallback((folderId: SharedFolderId) => sharedContent.openSharedFolder({ ...request, folderId }), [request, sharedContent]);

   return { state, operation, preview, setContents, confirm, cancel, dismiss, openFolder };
}
