import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/ipc/target-api';
import type { TargetCallResult } from '@/lib/api';
import { sharedContentApi } from '@/modules/shared-content/api';
import type { SharedRootActionResult, SharedRootCandidate, SharedRootIssue } from '@/modules/shared-content/contract';
import type { TargetId } from '@/modules/targets/contract';
import { ipcQueryKey } from '@/renderer/query/utils';

const sharedContentTargetIpc = createTargetIpcDescriptor(sharedContentApi);

type SharedRootsState =
   | { status: 'idle' }
   | { status: 'choosing' }
   | { status: 'entering'; checking?: boolean; failed?: boolean }
   | { status: 'confirming'; candidate: SharedRootCandidate }
   | { status: 'saving'; candidate: SharedRootCandidate | null }
   | { status: 'invalid'; issue: SharedRootIssue; detail?: string };

export type SharedRoots = ReturnType<typeof useSharedRoots>;

export function useSharedRoots(targetId: TargetId) {
   const sharedContent = window.encore.sharedContent;
   const queryClient = useQueryClient();
   const [state, setState] = useState<SharedRootsState>({ status: 'idle' });

   const refresh = useCallback(
      () => queryClient.invalidateQueries({ queryKey: ipcQueryKey(sharedContentTargetIpc.getOverview, targetId) }),
      [queryClient, targetId]
   );

   const choose = useCallback(async () => {
      setState({ status: 'choosing' });

      const choice = await sharedContent.chooseSharedRoot({ targetId }).catch(() => null);
      if (!choice || choice.status === 'cancelled') {
         setState({ status: 'idle' });
         return;
      }

      setState({ status: 'confirming', candidate: choice });
   }, [sharedContent, targetId]);

   // remote targets get no native picker, so the path is typed and checked over the wire
   const enter = useCallback(() => setState({ status: 'entering' }), []);

   const describe = useCallback(
      async (path: string) => {
         setState({ status: 'entering', checking: true });

         const response = await sharedContent.chooseRootCandidate({ targetId, path }).catch(() => null);
         const candidate = response?.status === 'ok' ? response.value : null;
         setState(candidate ? { status: 'confirming', candidate } : { status: 'entering', failed: true });
      },
      [sharedContent, targetId]
   );

   const finishAction = useCallback(
      async (action: () => Promise<TargetCallResult<SharedRootActionResult>>) => {
         const response = await action().catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({ status: 'invalid', issue: response?.status === 'unsupported' ? 'unsupported-target' : 'remote-failed' });
            return;
         }

         const result = response.value;
         if (result.status === 'invalid') {
            setState({ status: 'invalid', issue: result.issue, ...(result.detail ? { detail: result.detail } : {}) });
            return;
         }

         setState({ status: 'idle' });
         await refresh();
      },
      [refresh]
   );

   const add = useCallback(
      async (path: string, activate: boolean) => {
         setState((current) => ({ status: 'saving', candidate: current.status === 'confirming' ? current.candidate : null }));
         await finishAction(() => sharedContent.addRoot({ targetId, path, activate }));
      },
      [finishAction, sharedContent, targetId]
   );

   const activate = useCallback(
      async (path: string) => {
         setState({ status: 'saving', candidate: null });
         await finishAction(() => sharedContent.activateRoot({ targetId, path }));
      },
      [finishAction, sharedContent, targetId]
   );

   const forget = useCallback(
      async (path: string) => {
         setState({ status: 'saving', candidate: null });
         await finishAction(() => sharedContent.forgetRoot({ targetId, path }));
      },
      [finishAction, sharedContent, targetId]
   );

   const openRoot = useCallback((path: string) => sharedContent.openSharedRoot({ targetId, path }), [sharedContent, targetId]);

   const dismiss = useCallback(() => setState({ status: 'idle' }), []);

   return { state, choose, enter, describe, add, activate, forget, openRoot, dismiss };
}
