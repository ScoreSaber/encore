import { useCallback, useEffect, useRef, useState } from 'react';

import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { createLatestGuard } from '@/lib/state/machine';
import type { TargetReadyLaunchPreview, TargetUnavailableLaunchPreview } from '@/modules/launch/contract';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import type { LaunchLinkEvent, LaunchLinkIssue, LaunchLinkRequest } from '@/modules/shortcuts/contract';
import { inlineIpcResult } from '@/renderer/ipc-result';
import { usePendingLinkEvent } from '@/renderer/use-pending-link-event';

type DeepLinkLaunchState =
   | { status: 'idle' }
   | { status: 'received'; token: number; event: LaunchLinkEvent }
   | { status: 'rejected'; issue: LaunchLinkIssue; detail?: string }
   | { status: 'previewing'; installName: string; automatic: boolean }
   | {
        status: 'unavailable';
        installName: string;
        preview: TargetUnavailableLaunchPreview;
     }
   | {
        status: 'ready';
        token: number;
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
   | { status: 'failed'; error: Problem };

const previewFailure = createProblem('launch.preview-failed');
const startFailure = createProblem('launch.start-failed');
const pendingLinkFailure = createProblem('shortcuts.link-intake-failed');

export function useDeepLinkLaunch() {
   const { launch, shortcuts } = window.encore;
   const settings = useSettings();
   const { updateApp } = settings;
   const [state, setState] = useState<DeepLinkLaunchState>({ status: 'idle' });
   const [remember, setRemember] = useState(false);
   const guard = useRef(createLatestGuard());
   const startedTokens = useRef(new Set<number>());

   const start = useCallback(
      async (token: number, installName: string, request: LaunchLinkRequest, preview: TargetReadyLaunchPreview, automatic: boolean) => {
         if (!guard.current.isCurrent(token)) return;
         setState({
            status: 'starting',
            installName,
            request,
            preview,
            automatic
         });

         const started = await inlineIpcResult(() => launch.start(request), startFailure);
         if (!guard.current.isCurrent(token)) return;
         if (!started.ok) {
            setState({ status: 'failed', error: started.error });
            return;
         }

         setState(automatic ? { status: 'idle' } : { status: 'started', installName });
      },
      [launch]
   );

   const preview = useCallback(
      async (token: number, installName: string, request: LaunchLinkRequest, automatic: boolean) => {
         const answered = await Result.tryPromise({
            try: () => launch.preview(request),
            catch: () => previewFailure
         });
         if (!guard.current.isCurrent(token)) return;
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
            await start(token, installName, request, launchPreview, true);
         } else {
            setState({
               status: 'ready',
               token,
               installName,
               request,
               preview: launchPreview
            });
         }
      },
      [launch, start]
   );

   usePendingLinkEvent(
      shortcuts,
      (event) => {
         const token = guard.current.next();
         setRemember(false);
         setState({ status: 'received', token, event });
      },
      (error) => {
         guard.current.invalidate();
         setState({ status: 'failed', error });
      },
      pendingLinkFailure
   );

   useEffect(() => {
      if (state.status !== 'received' || settings.loadStatus === 'loading') return;
      if (startedTokens.current.has(state.token) || !guard.current.isCurrent(state.token)) return;

      startedTokens.current.add(state.token);
      if (startedTokens.current.size > 32) startedTokens.current.clear();

      const { event, token } = state;
      if (event.status === 'rejected') {
         const rejected: DeepLinkLaunchState = { status: 'rejected', issue: event.issue };
         if (event.detail) rejected.detail = event.detail;
         setState(rejected);
         return;
      }

      const automatic =
         canLaunchWithoutAsking(event.request) && settings.loadStatus === 'ready' && settings.snapshot?.app.linkHandling.launchWithoutAsking === true;
      setState({
         status: 'previewing',
         installName: event.installName,
         automatic
      });
      void preview(token, event.installName, event.request, automatic);
   }, [preview, settings.loadStatus, settings.snapshot, state]);

   const confirm = useCallback(async () => {
      if (state.status !== 'ready' || !guard.current.isCurrent(state.token)) return;

      const confirmToken = guard.current.next();
      if (remember) void updateApp({ linkHandling: { launchWithoutAsking: true } });
      await start(confirmToken, state.installName, state.request, state.preview, false);
   }, [remember, start, state, updateApp]);

   const dismiss = useCallback(() => {
      guard.current.invalidate();
      setRemember(false);
      setState({ status: 'idle' });
   }, []);

   return { state, remember, setRemember, confirm, dismiss };
}

export function canLaunchWithoutAsking({ options }: LaunchLinkRequest) {
   return options.args.length === 0 && !options.runAsAdmin;
}
