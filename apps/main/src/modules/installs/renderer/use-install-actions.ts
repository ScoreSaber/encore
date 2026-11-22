import { useCallback, useState } from 'react';

import { createProblem } from '@/lib/errors';
import type { InstallActionProblem, InstallActionRequest, InstallDeletePreview, InstallForgetPreview } from '@/modules/installs/contract';
import { useOperationFlow } from '@/modules/operations/renderer/use-operation-flow';
import { unwrapTarget } from '@/renderer/ipc-result';

type InstallActionReady =
   | { kind: 'delete'; preview: Extract<InstallDeletePreview, { status: 'ok' }> }
   | { kind: 'forget'; preview: Extract<InstallForgetPreview, { status: 'ok' }> };

const previewFailure = createProblem('installs.manage.preview-failed');
const startFailure = createProblem('installs.manage.start-failed');

export type InstallActions = ReturnType<typeof useInstallActions>;

export function useInstallActions(request: InstallActionRequest) {
   const installs = window.encore.installs;
   const flow = useOperationFlow<InstallActionReady, InstallActionProblem>(request.targetId);
   const { preview, start, submit } = flow;
   const [forgottenKey, setForgottenKey] = useState<string | null>(null);
   const requestKey = `${request.targetId}\0${request.installId}`;
   const removed = forgottenKey === requestKey || (flow.state.status === 'running' && flow.operation?.status === 'completed');

   const previewDelete = useCallback(
      () =>
         preview(
            'delete',
            async () => {
               const previewed = unwrapTarget(await installs.previewDelete(request));
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'delete', preview: previewed }
                  : { status: 'invalid', kind: 'delete', problem: previewed };
            },
            previewFailure
         ),
      [installs, preview, request]
   );

   const previewForget = useCallback(
      () =>
         preview(
            'forget',
            async () => {
               const previewed = unwrapTarget(await installs.previewForget(request));
               return previewed.status === 'ok'
                  ? { status: 'ready', kind: 'forget', preview: previewed }
                  : { status: 'invalid', kind: 'forget', problem: previewed };
            },
            previewFailure
         ),
      [installs, preview, request]
   );

   const confirm = useCallback(
      (ready: InstallActionReady) => {
         if (ready.kind === 'forget') {
            void submit(
               ready,
               () => installs.forget(request),
               startFailure,
               () => setForgottenKey(requestKey)
            );
            return;
         }

         void start(ready, () => installs.delete(request), startFailure);
      },
      [installs, request, requestKey, start, submit]
   );

   const openFolder = useCallback(() => installs.openFolder(request), [installs, request]);

   return { flow, forgetting: flow.state.status === 'submitting', removed, previewDelete, previewForget, confirm, openFolder };
}
