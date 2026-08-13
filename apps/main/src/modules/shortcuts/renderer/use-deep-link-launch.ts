import { useCallback, useEffect, useState } from 'react';

import { Result } from 'better-result';

import { usePendingLinkEvent } from '@/components/content/use-pending-link-event';

import type { IpcError } from '@/ipc/core';
import type { TargetReadyLaunchPreview, TargetUnavailableLaunchPreview } from '@/modules/launch/contract';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import type { LaunchLinkEvent, LaunchLinkIssue, LaunchLinkRequest } from '@/modules/shortcuts/contract';
import { inlineTargetIpcResult } from '@/renderer/ipc-result';

type DeepLinkLaunchState =
   | { status: 'idle' }
   | { status: 'received'; event: LaunchLinkEvent }
   | { status: 'rejected'; issue: LaunchLinkIssue; detail?: string }
   | { status: 'previewing'; installName: string; automatic: boolean }
   | {
        status: 'unavailable';
        installName: string;
        preview: TargetUnavailableLaunchPreview;
     }
   | {
        status: 'ready';
        installName: string;
        request: LaunchLinkRequest;
        preview: TargetReadyLaunchPreview;
     }
   | {
        status: 'starting';
        installName: string;
        request: LaunchLinkRequest;
        preview: TargetReadyLaunchPreview;
        automatic: boolean;
     }
   | { status: 'started'; installName: string }
   | { status: 'failed'; error: IpcError };

const previewFailure = {
   code: 'launch.preview-failed',
   message: 'the install could not be read'
};
const startFailure = {
   code: 'launch.start-failed',
   message: 'Beat Saber could not be started'
};
const pendingLinkFailure = {
   code: 'shortcuts.link-intake-failed',
   message: 'failed to read the pending launch link'
};

export function useDeepLinkLaunch() {
   const { launch, shortcuts } = window.encore;
   const settings = useSettings();
   const [state, setState] = useState<DeepLinkLaunchState>({ status: 'idle' });
   const [remember, setRemember] = useState(false);

   const start = useCallback(
      async (installName: string, request: LaunchLinkRequest, preview: TargetReadyLaunchPreview, automatic: boolean) => {
         setState({
            status: 'starting',
            installName,
            request,
            preview,
            automatic
         });

         const started = await inlineTargetIpcResult(() => launch.start(request), startFailure);
         if (!started.ok) {
            setState({ status: 'failed', error: started.error });
            return;
         }

         setState(automatic ? { status: 'idle' } : { status: 'started', installName });
      },
      [launch]
   );

   const preview = useCallback(
      async (installName: string, request: LaunchLinkRequest, automatic: boolean) => {
         const answered = await Result.tryPromise({
            try: () => launch.preview(request),
            catch: () => previewFailure
         });
         if (Result.isError(answered)) {
            setState({ status: 'failed', error: answered.error });
            return;
         }

         const response = answered.value;
         if (response.status !== 'ok') {
            setState({
               status: 'failed',
               error: response.status === 'unavailable' ? response.error : previewFailure
            });
            return;
         }

         const launchPreview = { ...response.value, targetId: response.targetId };
         if (launchPreview.status === 'unavailable') {
            setState({
               status: 'unavailable',
               installName,
               preview: launchPreview
            });
            return;
         }

         if (automatic) {
            await start(installName, request, launchPreview, true);
         } else {
            setState({
               status: 'ready',
               installName,
               request,
               preview: launchPreview
            });
         }
      },
      [launch, start]
   );

   const open = useCallback((event: LaunchLinkEvent) => {
      setRemember(false);
      setState({ status: 'received', event });
   }, []);
   const failPending = useCallback((error: IpcError) => setState({ status: 'failed', error }), []);

   usePendingLinkEvent(shortcuts, open, failPending, pendingLinkFailure);

   useEffect(() => {
      if (state.status !== 'received' || settings.loadStatus === 'loading') return;

      const { event } = state;
      if (event.status === 'rejected') {
         const rejected: DeepLinkLaunchState = { status: 'rejected', issue: event.issue };
         if (event.detail) rejected.detail = event.detail;
         setState(rejected);
         return;
      }

      const automatic = settings.loadStatus === 'ready' && settings.snapshot?.app.linkHandling.launchWithoutAsking === true;
      setState({
         status: 'previewing',
         installName: event.installName,
         automatic
      });
      void preview(event.installName, event.request, automatic);
   }, [preview, settings.loadStatus, settings.snapshot, state]);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready') return;

      if (remember) void settings.updateApp({ linkHandling: { launchWithoutAsking: true } });
      await start(state.installName, state.request, state.preview, false);
   }, [remember, settings, start, state]);

   const dismiss = useCallback(() => {
      setState({ status: 'idle' });
   }, []);

   return { state, remember, setRemember, confirm, dismiss };
}
