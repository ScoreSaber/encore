import { useCallback, useEffect, useState } from 'react';

import type { EncoreApi } from '@/ipc/api';
import type { IpcError } from '@/ipc/core';
import type { InstallActionProblem, InstallActionRequest, InstallDeletePreview, InstallForgetPreview } from '@/modules/installs/contract';
import type { OperationId } from '@/modules/operations/contract';
import { useOperations } from '@/modules/operations/renderer/use-operations';

type ReadyDeletePreview = Extract<InstallDeletePreview, { status: 'ok' }>;
type ReadyForgetPreview = Extract<InstallForgetPreview, { status: 'ok' }>;
type ReadyAction = { kind: 'delete'; preview: ReadyDeletePreview } | { kind: 'forget'; preview: ReadyForgetPreview };

type InstallActionKind = ReadyAction['kind'];

type InstallActionState =
   | { status: 'idle' }
   | { status: 'previewing'; kind: InstallActionKind }
   | { status: 'invalid'; kind: InstallActionKind; problem: InstallActionProblem }
   | ({ status: 'ready' | 'starting' } & ReadyAction)
   | ({ status: 'running'; operationId: OperationId } & ReadyAction)
   | { status: 'forgotten'; kind: 'forget'; preview: ReadyForgetPreview }
   | { status: 'failed'; kind: InstallActionKind; error: IpcError };

export type InstallActions = ReturnType<typeof useInstallActions>;

export function useInstallActions(request: InstallActionRequest) {
   const installs = window.encore.installs;
   const { operations, cancelOperation } = useOperations(request.targetId);
   const [state, setState] = useState<InstallActionState>({ status: 'idle' });

   useEffect(() => {
      setState({ status: 'idle' });
   }, [request.installId, request.targetId]);

   const operation = state.status === 'running' ? (operations.find((candidate) => candidate.id === state.operationId) ?? null) : null;
   const removed = state.status === 'forgotten' || (state.status === 'running' && operation?.status === 'completed');

   const preview = useCallback(
      async (kind: InstallActionKind) => {
         setState({ status: 'previewing', kind });

         const previewed = await previewAction(installs, request, kind).catch(() => null);
         setState(
            previewed ?? { status: 'failed', kind, error: { code: 'installs.manage.preview-failed', message: 'the install could not be read' } }
         );
      },
      [installs, request]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const kind = state.kind;
      const pending: InstallActionState = { ...state, status: 'starting' };
      setState(pending);

      const startFailure = { code: 'installs.manage.start-failed', message: 'the action could not be started' };

      if (state.kind === 'forget') {
         const response = await installs.forget(request).catch(() => null);
         const forgotten = response?.status === 'ok' ? response.value : null;
         setState(
            forgotten?.ok
               ? { status: 'forgotten', kind: 'forget', preview: state.preview }
               : { status: 'failed', kind, error: forgotten?.error ?? startFailure }
         );
         return;
      }

      const response = await installs.delete(request).catch(() => null);
      const started = response?.status === 'ok' ? response.value : null;

      setState(
         started?.ok
            ? { ...pending, status: 'running', operationId: started.value.id }
            : { status: 'failed', kind, error: started?.error ?? startFailure }
      );
   }, [installs, request, state]);

   const cancel = useCallback(() => {
      if (state.status !== 'running') return;

      void cancelOperation(state.operationId);
   }, [cancelOperation, state]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   const openFolder = useCallback(() => installs.openFolder(request), [installs, request]);

   return { state, operation, removed, preview, confirm, cancel, dismiss, openFolder };
}

async function previewAction(installs: EncoreApi['installs'], request: InstallActionRequest, kind: InstallActionKind): Promise<InstallActionState> {
   if (kind === 'forget') {
      const previewed = await installs.previewForget(request);
      if (previewed.status !== 'ok') {
         return { status: 'failed', kind, error: { code: 'installs.manage.preview-failed', message: 'the install could not be read' } };
      }
      return previewed.value.status === 'ok'
         ? { status: 'ready', kind, preview: previewed.value }
         : { status: 'invalid', kind, problem: previewed.value };
   }

   const previewed = await installs.previewDelete(request);
   if (previewed.status !== 'ok') {
      return { status: 'failed', kind, error: { code: 'installs.manage.preview-failed', message: 'the install could not be read' } };
   }
   return previewed.value.status === 'ok'
      ? { status: 'ready', kind, preview: previewed.value }
      : { status: 'invalid', kind, problem: previewed.value };
}
