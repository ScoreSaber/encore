import { useCallback, useEffect, useRef, useState } from 'react';

import { createProblem, type Problem } from '@/lib/errors';
import { createLatestGuard } from '@/lib/state/machine';
import { usePathChooser } from '@/modules/files/renderer/path-chooser';
import { installNameSchema, type InstallActionRequest, type InstallDetail, type InstallUpdateRequest } from '@/modules/installs/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { inlineIpcResult } from '@/renderer/ipc-result';

type EditorDraft = {
   name: string;
   color: string | null;
   path: string;
   canChangePath: boolean;
};

type InstallEditorState =
   | { status: 'closed' }
   | ({ status: 'choosing' | 'editing' | 'saving' } & EditorDraft)
   | ({ status: 'failed'; error: Problem } & EditorDraft);

type EditorChange = { name: string } | { color: string | null };

export type InstallEditor = ReturnType<typeof useInstallEditor>;

export function useInstallEditor(request: InstallActionRequest) {
   const installs = window.encore.installs;
   const chooser = usePathChooser();
   const { targets } = useTargets();
   const quest = targets.find((target) => target.id === request.targetId)?.kind === 'quest';
   const [state, setState] = useState<InstallEditorState>({ status: 'closed' });
   const guard = useRef(createLatestGuard());

   useEffect(() => {
      guard.current.invalidate();
      setState({ status: 'closed' });
   }, [request.installId, request.targetId]);

   const open = useCallback(
      (install: InstallDetail) => {
         guard.current.invalidate();
         setState({
            status: 'editing',
            name: install.name,
            color: install.color,
            path: install.path,
            canChangePath: !quest && install.source !== 'store'
         });
      },
      [quest]
   );

   const close = useCallback(() => {
      guard.current.invalidate();
      setState({ status: 'closed' });
   }, []);

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

      const token = guard.current.next();
      const draft = { name: state.name, color: state.color, path: state.path, canChangePath: state.canChangePath };
      setState({ status: 'choosing', ...draft });
      const path = await chooser.choose({ targetId: request.targetId, kind: 'folder', defaultPath: draft.path });
      if (!guard.current.isCurrent(token)) return;
      setState({ status: 'editing', ...draft, path: path ?? draft.path });
   }, [chooser, request.targetId, state]);

   const save = useCallback(async () => {
      if (state.status !== 'editing' && state.status !== 'failed') return;

      const token = guard.current.next();
      const draft = { name: state.name, color: state.color, path: state.path, canChangePath: state.canChangePath };
      setState({ status: 'saving', ...draft });

      const updateRequest: InstallUpdateRequest = { ...request, name: draft.name, color: draft.color };
      if (draft.canChangePath) updateRequest.path = draft.path;
      const saved = await inlineIpcResult(() => installs.update(updateRequest), createProblem('installs.manage.save-failed'));
      if (!guard.current.isCurrent(token)) return;

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

   const canSave = (state.status === 'editing' || state.status === 'failed') && installNameSchema.safeParse(state.name).success;

   return { state, canSave, open, close, edit, choosePath, save, dialog: chooser.dialog };
}
