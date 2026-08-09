import { useCallback, useState } from 'react';

import type { IpcError } from '@/ipc/core';
import type { InstallDetail, InstallImportPreview } from '@/modules/installs/contract';
import type { TargetId } from '@/modules/targets/contract';
import { inlineIpcResult } from '@/renderer/ipc-result';

type InvalidPreview = Extract<InstallImportPreview, { status: 'invalid' }>;
type ReadyPreview = Extract<InstallImportPreview, { status: 'ok' }>;

type InstallImportState =
   | { status: 'idle' }
   | { status: 'choosing' }
   | { status: 'unsupported' }
   | { status: 'invalid'; preview: InvalidPreview }
   | { status: 'ready'; preview: ReadyPreview }
   | { status: 'registering'; preview: ReadyPreview }
   | { status: 'registered'; preview: ReadyPreview; install: InstallDetail }
   | { status: 'failed'; error: IpcError };

export type InstallImporter = ReturnType<typeof useInstallImport>;

export function useInstallImport(targetId: TargetId) {
   const installs = window.encore.installs;
   const [state, setState] = useState<InstallImportState>({ status: 'idle' });

   const choose = useCallback(async () => {
      setState({ status: 'choosing' });
      const choice = await installs.chooseImportSource({ targetId }).catch(() => null);

      if (!choice) {
         setState({ status: 'failed', error: { code: 'installs.import.choose-failed', message: 'the folder picker could not be opened' } });
         return;
      }
      if (choice.status === 'cancelled') {
         setState({ status: 'idle' });
         return;
      }
      if (choice.status === 'unsupported') {
         setState({ status: 'unsupported' });
         return;
      }

      setState(choice.preview.status === 'ok' ? { status: 'ready', preview: choice.preview } : { status: 'invalid', preview: choice.preview });
   }, [installs, targetId]);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const preview = state.preview;
      setState({ status: 'registering', preview });

      const registered = await inlineIpcResult(() => installs.import({ targetId, sourcePath: preview.sourcePath }), {
         code: 'installs.import.register-failed',
         message: 'the install could not be registered'
      });

      setState(registered.ok ? { status: 'registered', preview, install: registered.value } : { status: 'failed', error: registered.error });
   }, [installs, state, targetId]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   return { state, choose, confirm, dismiss };
}
