import { useCallback, useState } from 'react';

import { Result } from 'better-result';

import type { IpcError } from '@/ipc/core';
import { installNameSchema, type InstallActionRequest, type InstallDetail, type InstallUpdateRequest } from '@/modules/installs/contract';
import { localTargetId } from '@/modules/targets/contract';
import { inlineTargetIpcResult } from '@/renderer/ipc-result';

type EditorDraft = {
   name: string;
   color: string | null;
   path: string;
   canChangePath: boolean;
};

type InstallEditorState =
   | { status: 'closed' }
   | ({ status: 'choosing' | 'editing' | 'saving' } & EditorDraft)
   | ({ status: 'failed'; error: IpcError } & EditorDraft);

type EditorChange = { name: string } | { color: string | null };

export type InstallEditor = ReturnType<typeof useInstallEditor>;

export function useInstallEditor(request: InstallActionRequest) {
   const installs = window.encore.installs;
   const [state, setState] = useState<InstallEditorState>({ status: 'closed' });

   const open = useCallback(
      (install: InstallDetail) =>
         setState({
            status: 'editing',
            name: install.name,
            color: install.color,
            path: install.path,
            canChangePath: request.targetId === localTargetId && install.source !== 'store'
         }),
      [request.targetId]
   );
   const close = useCallback(() => setState({ status: 'closed' }), []);

   const edit = useCallback((change: EditorChange) => {
      setState((current) => {
         if (current.status === 'editing') return { ...current, ...change };
         if (current.status !== 'failed') return current;

         return {
            status: 'editing',
            name: 'name' in change ? change.name : current.name,
            color: 'color' in change ? change.color : current.color,
            path: current.path,
            canChangePath: current.canChangePath
         };
      });
   }, []);

   const choosePath = useCallback(async () => {
      if ((state.status !== 'editing' && state.status !== 'failed') || !state.canChangePath) return;

      const draft = { name: state.name, color: state.color, path: state.path, canChangePath: state.canChangePath };
      setState({ status: 'choosing', ...draft });
      const picked = await Result.tryPromise({
         try: () => installs.chooseInstallLocation(request),
         catch: (): IpcError => ({ code: 'installs.manage.choose-path-failed', message: 'the folder picker could not be opened' })
      });

      if (Result.isError(picked)) {
         setState({ status: 'failed', ...draft, error: picked.error });
      } else if (picked.value.status === 'selected') {
         setState({ status: 'editing', ...draft, path: picked.value.path });
      } else if (picked.value.status === 'unsupported') {
         setState({
            status: 'failed',
            ...draft,
            error: { code: 'installs.manage.unsupported-target', message: 'this device cannot change an install folder from Encore' }
         });
      } else {
         setState({ status: 'editing', ...draft });
      }
   }, [installs, request, state]);

   const save = useCallback(async () => {
      if (state.status !== 'editing') return;

      const draft = { name: state.name, color: state.color, path: state.path, canChangePath: state.canChangePath };
      setState({ status: 'saving', ...draft });

      const updateRequest: InstallUpdateRequest = { ...request, name: draft.name, color: draft.color };
      if (draft.canChangePath) updateRequest.path = draft.path;
      const saved = await inlineTargetIpcResult(() => installs.update(updateRequest), {
         code: 'installs.manage.save-failed',
         message: 'the install could not be saved'
      });
      setState(
         saved.ok
            ? { status: 'closed' }
            : {
                 status: 'failed',
                 ...draft,
                 error: saved.error
              }
      );
   }, [installs, request, state]);

   const canSave = state.status === 'editing' && installNameSchema.safeParse(state.name).success;

   return { state, canSave, open, close, edit, choosePath, save };
}
