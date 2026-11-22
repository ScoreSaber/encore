import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { TargetCallResult } from '@/lib/api';
import { createLatestGuard } from '@/lib/state/machine';
import { usePathChooser } from '@/modules/files/renderer/path-chooser';
import type { SharedRootActionResult, SharedRootCandidate, SharedRootIssue } from '@/modules/shared-content/contract';
import { sharedContentOverviewQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import type { TargetId } from '@/modules/targets/contract';

type SharedRootsState =
   | { status: 'idle' }
   | { status: 'choosing' }
   | { status: 'confirming'; candidate: SharedRootCandidate }
   | { status: 'saving-root'; candidate: SharedRootCandidate }
   | { status: 'saving-action' }
   | { status: 'invalid'; issue: SharedRootIssue; detail?: string };

export type SharedRoots = ReturnType<typeof useSharedRoots>;

export function useSharedRoots(targetId: TargetId) {
   const sharedContent = window.encore.sharedContent;
   const queryClient = useQueryClient();
   const [state, setState] = useState<SharedRootsState>({ status: 'idle' });
   const [shownTargetId, setShownTargetId] = useState(targetId);
   const guardRef = useRef<ReturnType<typeof createLatestGuard> | null>(null);
   const busyRef = useRef(false);
   const chooser = usePathChooser();

   if (shownTargetId !== targetId) {
      setShownTargetId(targetId);
      setState({ status: 'idle' });
   }

   const getGuard = useCallback(() => {
      if (!guardRef.current) guardRef.current = createLatestGuard();
      return guardRef.current;
   }, []);

   useEffect(() => {
      const guard = getGuard();
      guard.invalidate();
      busyRef.current = false;

      return () => {
         guard.invalidate();
         busyRef.current = false;
      };
   }, [getGuard, targetId]);

   const refresh = useCallback(
      () => queryClient.invalidateQueries({ queryKey: sharedContentOverviewQueryOptions(targetId).queryKey }),
      [queryClient, targetId]
   );

   const choose = useCallback(async () => {
      if (busyRef.current) return;

      const guard = getGuard();
      const token = guard.next();
      busyRef.current = true;
      setState({ status: 'choosing' });

      try {
         const path = await chooser.choose({ targetId, kind: 'folder' });
         if (!guard.isCurrent(token)) return;
         if (!path) {
            setState({ status: 'idle' });
            return;
         }

         const response = (await Result.tryPromise(() => sharedContent.chooseRootCandidate({ targetId, path }))).unwrapOr(null);
         if (!guard.isCurrent(token)) return;

         setState(
            response?.status === 'ok'
               ? { status: 'confirming', candidate: response.value }
               : { status: 'invalid', issue: response?.status === 'unsupported' ? 'unsupported-target' : 'remote-failed' }
         );
      } finally {
         if (guard.isCurrent(token)) busyRef.current = false;
      }
   }, [chooser, getGuard, sharedContent, targetId]);

   const finishAction = useCallback(
      async (token: number, action: () => Promise<TargetCallResult<SharedRootActionResult>>) => {
         const guard = getGuard();
         try {
            const response = (await Result.tryPromise(action)).unwrapOr(null);
            if (!guard.isCurrent(token)) return;
            if (!response || response.status !== 'ok') {
               setState({ status: 'invalid', issue: response?.status === 'unsupported' ? 'unsupported-target' : 'remote-failed' });
               return;
            }

            const result = response.value;
            if (result.status === 'invalid') {
               const invalid: SharedRootsState = { status: 'invalid', issue: result.issue };
               if (result.detail) invalid.detail = result.detail;
               setState(invalid);
               return;
            }

            setState({ status: 'idle' });
            await refresh();
         } finally {
            if (guard.isCurrent(token)) busyRef.current = false;
         }
      },
      [getGuard, refresh]
   );

   const add = useCallback(
      async (path: string, activate: boolean) => {
         if (busyRef.current) return;

         const token = getGuard().next();
         busyRef.current = true;
         setState((current) =>
            current.status === 'confirming' ? { status: 'saving-root', candidate: current.candidate } : { status: 'saving-action' }
         );
         await finishAction(token, () => sharedContent.addRoot({ targetId, path, activate }));
      },
      [finishAction, getGuard, sharedContent, targetId]
   );

   const activate = useCallback(
      async (path: string) => {
         if (busyRef.current) return;

         const token = getGuard().next();
         busyRef.current = true;
         setState({ status: 'saving-action' });
         await finishAction(token, () => sharedContent.activateRoot({ targetId, path }));
      },
      [finishAction, getGuard, sharedContent, targetId]
   );

   const forget = useCallback(
      async (path: string) => {
         if (busyRef.current) return;

         const token = getGuard().next();
         busyRef.current = true;
         setState({ status: 'saving-action' });
         await finishAction(token, () => sharedContent.forgetRoot({ targetId, path }));
      },
      [finishAction, getGuard, sharedContent, targetId]
   );

   const openRoot = useCallback((path: string) => sharedContent.openSharedRoot({ targetId, path }), [sharedContent, targetId]);

   const dismiss = useCallback(() => {
      if (busyRef.current) return;

      getGuard().invalidate();
      setState({ status: 'idle' });
   }, [getGuard]);

   return { state, choose, add, activate, forget, openRoot, dismiss, dialog: chooser.dialog };
}
