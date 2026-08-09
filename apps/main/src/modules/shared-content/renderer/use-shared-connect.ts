import { useCallback, useState } from 'react';

import type { IpcError } from '@/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import type { OperationId } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';
import type {
   ReadySharedConnectPreview,
   SharedConnectAction,
   SharedConnectProblem,
   SharedConnectRequest,
   SharedContentsMode
} from '@/modules/shared-content/contract';
import type { TargetId } from '@/modules/targets/contract';
import { inlineTargetIpcResult } from '@/renderer/ipc-result';

type ConnectTarget = { installId: InstallId; installName: string; action: SharedConnectAction; rootPath: string };

type SharedConnectState =
   | { status: 'idle' }
   | ({ status: 'previewing' } & ConnectTarget)
   | ({ status: 'invalid'; problem: SharedConnectProblem } & ConnectTarget)
   | ({ status: 'ready' | 'starting'; preview: ReadySharedConnectPreview } & ConnectTarget)
   | ({ status: 'running'; operationId: OperationId; preview: ReadySharedConnectPreview } & ConnectTarget)
   | ({ status: 'failed'; error: IpcError } & ConnectTarget);

export type SharedConnect = ReturnType<typeof useSharedConnect>;

export function useSharedConnect(targetId: TargetId) {
   const sharedContent = window.encore.sharedContent;
   const { operations, cancelOperation } = useOperations(targetId);
   const [state, setState] = useState<SharedConnectState>({ status: 'idle' });

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;

   const preview = useCallback(
      async (target: ConnectTarget, options?: { contents?: SharedContentsMode; includeRisky?: boolean }, current?: ReadySharedConnectPreview) => {
         setState(
            current
               ? {
                    status: 'ready',
                    preview: {
                       ...current,
                       ...(options?.contents ? { contents: options.contents } : {}),
                       ...(options?.includeRisky !== undefined ? { includeRisky: options.includeRisky } : {})
                    },
                    ...target
                 }
               : { status: 'previewing', ...target }
         );

         const request: SharedConnectRequest & { targetId: TargetId } = {
            targetId,
            installId: target.installId,
            action: target.action,
            rootPath: target.rootPath,
            ...(options?.contents ? { contents: options.contents } : {}),
            ...(options?.includeRisky !== undefined ? { includeRisky: options.includeRisky } : {})
         };
         const response = await sharedContent.previewConnect(request).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({ status: 'failed', error: { code: 'shared-content.preview-failed', message: 'the install could not be read' }, ...target });
            return;
         }

         const previewed = response.value;
         setState(
            previewed.status === 'ok' ? { status: 'ready', preview: previewed, ...target } : { status: 'invalid', problem: previewed, ...target }
         );
      },
      [sharedContent, targetId]
   );

   const open = useCallback((target: ConnectTarget) => void preview(target), [preview]);

   const setContents = useCallback(
      (contents: SharedContentsMode) => {
         if (state.status !== 'ready') return;

         const { installId, installName, action, rootPath } = state;
         void preview({ installId, installName, action, rootPath }, { contents, includeRisky: state.preview.includeRisky }, state.preview);
      },
      [preview, state]
   );

   const setIncludeRisky = useCallback(
      (includeRisky: boolean) => {
         if (state.status !== 'ready') return;

         const { installId, installName, action, rootPath } = state;
         void preview({ installId, installName, action, rootPath }, { contents: state.preview.contents, includeRisky }, state.preview);
      },
      [preview, state]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const pending = state.preview;
      setState({ ...state, status: 'starting', preview: pending });

      const started = await inlineTargetIpcResult(
         () =>
            sharedContent.startConnect({
               targetId,
               installId: state.installId,
               action: state.action,
               rootPath: pending.rootPath,
               contents: pending.contents,
               includeRisky: pending.includeRisky
            }),
         { code: 'shared-content.connect-failed', message: 'the change could not be started' }
      );

      setState(
         started.ok
            ? { ...state, status: 'running', operationId: started.value.id, preview: pending }
            : { ...state, status: 'failed', error: started.error }
      );
   }, [sharedContent, state, targetId]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   return { state, operation, open, setContents, setIncludeRisky, confirm, cancel, dismiss };
}
