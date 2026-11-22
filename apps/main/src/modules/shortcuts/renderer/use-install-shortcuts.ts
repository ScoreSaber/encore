import { useCallback, useRef, useState } from 'react';

import { queryOptions, useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { createLatestGuard } from '@/lib/state/machine';
import type { InstallActionRequest } from '@/modules/installs/contract';
import type { LaunchOptions } from '@/modules/launch/contract';
import type { ReadyShortcutPreview, ShortcutKind, ShortcutSummary, UnavailableShortcutPreview } from '@/modules/shortcuts/contract';
import { inlineIpcResult } from '@/renderer/ipc-result';
import { apiKey } from '@/renderer/query/api-query';

export const shortcutStateQueryOptions = queryOptions({
   queryKey: apiKey('shortcuts', 'getState'),
   queryFn: () => window.encore.shortcuts.getState()
});

type InstallShortcutState =
   | { status: 'idle' }
   | { status: 'previewing'; kind: ShortcutKind }
   | { status: 'unavailable'; preview: UnavailableShortcutPreview }
   | { status: 'ready'; token: number; preview: ReadyShortcutPreview; request: InstallActionRequest; options: LaunchOptions }
   | { status: 'creating'; preview: ReadyShortcutPreview }
   | { status: 'created'; summary: ShortcutSummary }
   | { status: 'failed'; error: Problem };

export type InstallShortcuts = ReturnType<typeof useInstallShortcuts>;

export function useInstallShortcuts(request: InstallActionRequest, options: LaunchOptions) {
   const shortcutApi = window.encore.shortcuts;
   const shortcuts = useQuery(shortcutStateQueryOptions);
   const support = shortcuts.data ?? null;
   const [state, setState] = useState<InstallShortcutState>({ status: 'idle' });
   const guard = useRef(createLatestGuard());

   const start = useCallback(
      async (kind: ShortcutKind) => {
         const token = guard.current.next();
         const capturedRequest = { ...request };
         const capturedOptions = options;
         setState({ status: 'previewing', kind });

         const previewed = await Result.tryPromise({
            try: () => shortcutApi.preview({ ...capturedRequest, kind, options: capturedOptions }),
            catch: (cause) => createProblem('shortcuts.preview-failed', { cause })
         });
         if (!guard.current.isCurrent(token)) return;
         if (Result.isError(previewed)) {
            setState({ status: 'failed', error: previewed.error });
            return;
         }

         const preview = previewed.value;
         setState(
            preview.status === 'ok'
               ? { status: 'ready', token, preview, request: capturedRequest, options: capturedOptions }
               : { status: 'unavailable', preview }
         );
      },
      [options, request, shortcutApi]
   );

   const confirm = useCallback(async () => {
      if (state.status !== 'ready' || !guard.current.isCurrent(state.token)) return;

      const token = guard.current.next();
      const { preview, request: capturedRequest, options: capturedOptions } = state;
      setState({ status: 'creating', preview });

      const created = await inlineIpcResult(
         () => shortcutApi.create({ ...capturedRequest, kind: preview.kind, options: capturedOptions }),
         createProblem('shortcuts.create-failed')
      );
      if (!guard.current.isCurrent(token)) return;

      setState(created.ok ? { status: 'created', summary: created.value } : { status: 'failed', error: created.error });
   }, [shortcutApi, state]);

   const dismiss = useCallback(() => {
      guard.current.invalidate();
      setState({ status: 'idle' });
   }, []);

   return { support, state, start, confirm, dismiss };
}
