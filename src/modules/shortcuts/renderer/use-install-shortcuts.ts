import { useCallback, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { IpcError } from '@/app/ipc/core';
import { inlineIpcResult } from '@/app/renderer/ipc-result';
import type { InstallActionRequest } from '@/modules/installs/contract';
import type { LaunchOptions } from '@/modules/launch/contract';
import type { ReadyShortcutPreview, ShortcutKind, ShortcutSummary, UnavailableShortcutPreview } from '@/modules/shortcuts/contract';
import { shortcutStateQueryOptions } from '@/modules/shortcuts/renderer/shortcut-queries';

export type InstallShortcutState =
   | { status: 'idle' }
   | { status: 'previewing'; kind: ShortcutKind }
   | { status: 'unavailable'; preview: UnavailableShortcutPreview }
   | { status: 'ready' | 'creating'; preview: ReadyShortcutPreview }
   | { status: 'created'; summary: ShortcutSummary }
   | { status: 'failed'; error: IpcError };

export type InstallShortcuts = ReturnType<typeof useInstallShortcuts>;

export function useInstallShortcuts(request: InstallActionRequest, options: LaunchOptions) {
   const shortcutApi = window.encore.shortcuts;
   const shortcuts = useQuery(shortcutStateQueryOptions);
   const support = shortcuts.data ?? null;
   const [state, setState] = useState<InstallShortcutState>({ status: 'idle' });

   const start = useCallback(
      async (kind: ShortcutKind) => {
         setState({ status: 'previewing', kind });

         const preview = await shortcutApi.preview({ ...request, kind, options }).catch(() => null);
         if (!preview) {
            setState({ status: 'failed', error: { code: 'shortcuts.preview-failed', message: 'the shortcut could not be prepared' } });
            return;
         }

         setState(preview.status === 'ok' ? { status: 'ready', preview } : { status: 'unavailable', preview });
      },
      [options, request, shortcutApi]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const preview = state.preview;
      setState({ status: 'creating', preview });

      const created = await inlineIpcResult(() => shortcutApi.create({ ...request, kind: preview.kind, options }), {
         code: 'shortcuts.create-failed',
         message: 'the shortcut could not be written'
      });

      setState(created.ok ? { status: 'created', summary: created.value } : { status: 'failed', error: created.error });
   }, [options, request, shortcutApi, state]);

   const dismiss = useCallback(() => {
      setState({ status: 'idle' });
   }, []);

   return { support, state, start, confirm, dismiss };
}
