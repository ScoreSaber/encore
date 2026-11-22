import { useCallback } from 'react';

import { createProblem } from '@/lib/errors';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import {
   defaultContentsMode,
   type ReadySharedContentPreview,
   type SharedContentAction,
   type SharedContentActionProblem,
   type SharedContentsMode,
   type SharedFolderId
} from '@/modules/shared-content/contract';
import { unwrapTarget } from '@/renderer/ipc-result';

type SharedContentReady = { kind: SharedContentAction; preview: ReadySharedContentPreview };

export type SharedContentActions = ReturnType<typeof useSharedContentActions>;

export function useSharedContentActions(request: TargetSharedContentRequest) {
   const sharedContent = window.encore.sharedContent;
   const flow = useOperationFlow<SharedContentReady, SharedContentActionProblem>(request.targetId);
   const { preview, start, state } = flow;

   const load = useCallback(
      (action: SharedContentAction, folderId: SharedFolderId, contents: SharedContentsMode, pending?: SharedContentReady) =>
         preview(
            action,
            async () => {
               const previewed = unwrapTarget(await sharedContent.preview({ ...request, folderId, action, contents }));
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: action, preview: previewed }
                  : { status: 'invalid', kind: action, problem: previewed };
            },
            createProblem('shared-content.preview-failed'),
            pending
         ),
      [preview, request, sharedContent]
   );

   const open = useCallback((action: SharedContentAction, folderId: SharedFolderId) => load(action, folderId, defaultContentsMode(action)), [load]);

   const setContents = useCallback(
      (contents: SharedContentsMode) => {
         if (state.status !== 'ready' && state.status !== 'repreviewing') return;

         void load(state.kind, state.preview.folderId, contents, { kind: state.kind, preview: { ...state.preview, contents } });
      },
      [load, state]
   );

   const confirm = useCallback(
      (ready: SharedContentReady) =>
         void start(
            ready,
            () => sharedContent.start({ ...request, folderId: ready.preview.folderId, action: ready.kind, contents: ready.preview.contents }),
            createProblem('shared-content.start-failed')
         ),
      [request, sharedContent, start]
   );

   const openFolder = useCallback((folderId: SharedFolderId) => sharedContent.openSharedFolder({ ...request, folderId }), [request, sharedContent]);

   return { flow, open, setContents, confirm, openFolder };
}
