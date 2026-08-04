import { useCallback, useEffect, useState } from 'react';

import type { IpcError } from '@/app/ipc/core';
import type { TargetReadyLaunchPreview, TargetUnavailableLaunchPreview } from '@/modules/launch/contract';
import type { LaunchLinkIssue, LaunchLinkRequest } from '@/modules/shortcuts/contract';

type DeepLinkLaunchState =
   | { status: 'idle' }
   | { status: 'rejected'; issue: LaunchLinkIssue; detail?: string }
   | { status: 'previewing'; installName: string }
   | { status: 'unavailable'; installName: string; preview: TargetUnavailableLaunchPreview }
   | { status: 'ready' | 'starting'; installName: string; request: LaunchLinkRequest; preview: TargetReadyLaunchPreview }
   | { status: 'started'; installName: string }
   | { status: 'failed'; error: IpcError };

export function useDeepLinkLaunch() {
   const { launch, shortcuts } = window.encore;
   const [state, setState] = useState<DeepLinkLaunchState>({ status: 'idle' });

   useEffect(() => {
      return shortcuts.onLinkOpened((event) => {
         if (event.status === 'rejected') {
            setState({ status: 'rejected', issue: event.issue, ...(event.detail ? { detail: event.detail } : {}) });
            return;
         }

         setState({ status: 'previewing', installName: event.installName });

         void launch
            .preview({ targetId: event.request.targetId, installId: event.request.installId, options: event.request.options })
            .then((response) => {
               if (response.status !== 'ok') {
                  setState({ status: 'failed', error: { code: 'launch.preview-failed', message: 'the install could not be read' } });
                  return;
               }
               const preview = { ...response.value, targetId: response.targetId };
               setState(
                  preview.status === 'ok'
                     ? { status: 'ready', installName: event.installName, request: event.request, preview }
                     : { status: 'unavailable', installName: event.installName, preview }
               );
            })
            .catch(() => {
               setState({ status: 'failed', error: { code: 'launch.preview-failed', message: 'the install could not be read' } });
            });
      });
   }, [launch, shortcuts]);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      const { installName, request, preview } = state;
      setState({ status: 'starting', installName, request, preview });

      const response = await launch.start({ targetId: request.targetId, installId: request.installId, options: request.options }).catch(() => null);
      const started = response?.status === 'ok' ? response.value : null;
      setState(
         started?.ok
            ? { status: 'started', installName }
            : { status: 'failed', error: started?.error ?? { code: 'launch.start-failed', message: 'Beat Saber could not be started' } }
      );
   }, [launch, state]);

   const dismiss = useCallback(() => {
      setState({ status: 'idle' });
   }, []);

   return { state, confirm, dismiss };
}
