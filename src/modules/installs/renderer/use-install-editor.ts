import { useCallback, useState } from 'react';

import type { IpcError } from '@/app/ipc/core';
import { installNameSchema, type InstallActionRequest, type InstallDetail } from '@/modules/installs/contract';

type EditorDraft = {
   name: string;
   color: string | null;
};

type InstallEditorState =
   | { status: 'closed' }
   | ({ status: 'editing' | 'saving' } & EditorDraft)
   | ({ status: 'failed'; error: IpcError } & EditorDraft);

export type InstallEditor = ReturnType<typeof useInstallEditor>;

export function useInstallEditor(request: InstallActionRequest) {
   const installs = window.encore.installs;
   const [state, setState] = useState<InstallEditorState>({ status: 'closed' });

   const open = useCallback((install: InstallDetail) => setState({ status: 'editing', name: install.name, color: install.color }), []);
   const close = useCallback(() => setState({ status: 'closed' }), []);

   const edit = useCallback((draft: Partial<EditorDraft>) => {
      setState((current) => (current.status === 'closed' || current.status === 'saving' ? current : { ...current, ...draft, status: 'editing' }));
   }, []);

   const save = useCallback(async () => {
      if (state.status === 'closed' || state.status === 'saving') return;

      const draft = { name: state.name, color: state.color };
      setState({ status: 'saving', ...draft });

      const response = await installs.update({ ...request, ...draft }).catch(() => null);
      const saved = response?.status === 'ok' ? response.value : null;
      setState(
         saved?.ok
            ? { status: 'closed' }
            : {
                 status: 'failed',
                 ...draft,
                 error: saved?.error ?? { code: 'installs.manage.save-failed', message: 'the install could not be saved' }
              }
      );
   }, [installs, request, state]);

   const canSave = state.status === 'editing' && installNameSchema.safeParse(state.name).success;

   return { state, canSave, open, close, edit, save };
}
