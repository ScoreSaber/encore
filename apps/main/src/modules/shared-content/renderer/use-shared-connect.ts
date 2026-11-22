import { useCallback } from 'react';

import { createProblem } from '@/lib/errors';
import type { InstallId } from '@/modules/installs/contract';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import type {
   ReadySharedConnectPreview,
   SharedConnectAction,
   SharedConnectProblem,
   SharedConnectRequest,
   SharedContentsMode
} from '@/modules/shared-content/contract';
import type { TargetId } from '@/modules/targets/contract';
import { unwrapTarget } from '@/renderer/ipc-result';

type ConnectTarget = { installId: InstallId; installName: string; action: SharedConnectAction; rootPath: string };
type SharedConnectReady = { kind: SharedConnectAction; target: ConnectTarget; preview: ReadySharedConnectPreview };

export type SharedConnect = ReturnType<typeof useSharedConnect>;

export function useSharedConnect(targetId: TargetId) {
   const sharedContent = window.encore.sharedContent;
   const flow = useOperationFlow<SharedConnectReady, SharedConnectProblem>(targetId);
   const { preview, start, state } = flow;

   const load = useCallback(
      (next: ConnectTarget, choices: Pick<SharedConnectRequest, 'contents' | 'includeRisky'> = {}, pending?: SharedConnectReady) =>
         preview(
            next.action,
            async () => {
               const previewed = unwrapTarget(
                  await sharedContent.previewConnect({
                     targetId,
                     installId: next.installId,
                     action: next.action,
                     rootPath: next.rootPath,
                     ...choices
                  })
               );
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: next.action, target: next, preview: previewed }
                  : { status: 'invalid', kind: next.action, problem: previewed };
            },
            createProblem('shared-content.connect-preview-failed'),
            pending
         ),
      [preview, sharedContent, targetId]
   );

   const open = useCallback((next: ConnectTarget) => void load(next), [load]);

   const choose = useCallback(
      (change: { contents?: SharedContentsMode; includeRisky?: boolean }) => {
         if (state.status !== 'ready' && state.status !== 'repreviewing') return;

         const choices = { contents: state.preview.contents, includeRisky: state.preview.includeRisky, ...change };
         void load(state.target, choices, { kind: state.kind, target: state.target, preview: { ...state.preview, ...choices } });
      },
      [load, state]
   );

   const confirm = useCallback(
      (ready: SharedConnectReady) => {
         void start(
            ready,
            () =>
               sharedContent.startConnect({
                  targetId,
                  installId: ready.target.installId,
                  action: ready.kind,
                  rootPath: ready.preview.rootPath,
                  contents: ready.preview.contents,
                  includeRisky: ready.preview.includeRisky
               }),
            createProblem('shared-content.start-failed')
         );
      },
      [sharedContent, start, targetId]
   );

   return {
      flow,
      open,
      setContents: (contents: SharedContentsMode) => choose({ contents }),
      setIncludeRisky: (includeRisky: boolean) => choose({ includeRisky }),
      confirm
   };
}
