import { useCallback, useEffect, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { TargetCallResult } from '@/lib/api';
import { causeMessage } from '@/lib/errors';
import { createLatestGuard } from '@/lib/state/machine';
import { usePathChooser } from '@/modules/files/renderer/path-chooser';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import type { CustomSharedFolder, CustomSharedFolderActionResult, CustomSharedFolderIssue, SharedFolderId } from '@/modules/shared-content/contract';
import { sharedContentListQueryOptions, sharedContentOverviewQueryOptions } from '@/modules/shared-content/renderer/shared-content-queries';
import type { SharedContentActions } from '@/modules/shared-content/renderer/use-shared-content-actions';

type CustomSharedFoldersState =
   | { status: 'idle' }
   | { status: 'choosing' | 'saving' }
   | { status: 'invalid'; issue: CustomSharedFolderIssue; detail?: string };

export function useCustomSharedFolders(request: TargetSharedContentRequest, actions: SharedContentActions) {
   const sharedContent = window.encore.sharedContent;
   const queryClient = useQueryClient();
   const requestKey = `${request.targetId}\0${request.installId}`;
   const [state, setState] = useState<CustomSharedFoldersState>({ status: 'idle' });
   const [shownKey, setShownKey] = useState(requestKey);
   const guardRef = useRef<ReturnType<typeof createLatestGuard> | null>(null);
   const busyRef = useRef(false);
   const chooser = usePathChooser();

   if (shownKey !== requestKey) {
      setShownKey(requestKey);
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
   }, [getGuard, requestKey]);

   const runAction = useCallback(
      async (
         token: number,
         action: () => Promise<TargetCallResult<CustomSharedFolderActionResult>>,
         complete: (folder: CustomSharedFolder) => Promise<void>
      ) => {
         const guard = getGuard();
         const answered = await Result.tryPromise({
            try: action,
            catch: causeMessage
         });
         if (!guard.isCurrent(token)) return;
         if (Result.isError(answered)) {
            setState({ status: 'invalid', issue: 'write-failed', detail: answered.error });
            return;
         }

         const response = answered.value;
         if (response.status !== 'ok') {
            const invalid: CustomSharedFoldersState = {
               status: 'invalid',
               issue: response.status === 'unsupported' ? 'unsupported-target' : 'write-failed'
            };
            if (response.status === 'unavailable') invalid.detail = response.error.message;
            setState(invalid);
            return;
         }

         if (response.value.status === 'invalid') {
            const invalid: CustomSharedFoldersState = { status: 'invalid', issue: response.value.issue };
            if (response.value.detail) invalid.detail = response.value.detail;
            setState(invalid);
            return;
         }

         await complete(response.value.folder);
      },
      [getGuard]
   );

   const refresh = useCallback(async () => {
      await Promise.all([
         queryClient.invalidateQueries({ queryKey: sharedContentListQueryOptions(request).queryKey }),
         queryClient.invalidateQueries({ queryKey: sharedContentOverviewQueryOptions(request.targetId).queryKey })
      ]);
   }, [queryClient, request]);

   const add = useCallback(
      async (installPath: string | undefined) => {
         if (busyRef.current) return;

         const guard = getGuard();
         const token = guard.next();
         busyRef.current = true;
         setState({ status: 'choosing' });

         try {
            const path = await chooser.choose({ targetId: request.targetId, kind: 'folder', defaultPath: installPath });
            if (!guard.isCurrent(token)) return;
            if (!path) {
               setState({ status: 'idle' });
               return;
            }
            const chosen = await Result.tryPromise({
               try: () => sharedContent.chooseCustomFolder({ ...request, path }),
               catch: causeMessage
            });
            if (!guard.isCurrent(token)) return;
            if (Result.isError(chosen)) {
               setState({ status: 'invalid', issue: 'choose-failed', detail: chosen.error });
               return;
            }
            if (chosen.value.status !== 'ok') {
               setState({ status: 'invalid', issue: chosen.value.status === 'unsupported' ? 'unsupported-target' : 'choose-failed' });
               return;
            }
            const choice = chosen.value.value;
            if (choice.status === 'invalid') {
               const invalid: CustomSharedFoldersState = { status: 'invalid', issue: choice.issue };
               if (choice.detail) invalid.detail = choice.detail;
               setState(invalid);
               return;
            }

            setState({ status: 'saving' });
            await runAction(
               token,
               () => sharedContent.addCustomFolder({ ...request, relativePath: choice.relativePath }),
               async (folder) => {
                  setState({ status: 'idle' });
                  await refresh();
                  if (!guard.isCurrent(token)) return;
                  await actions.open('link', folder.id);
               }
            );
         } finally {
            if (guard.isCurrent(token)) busyRef.current = false;
         }
      },
      [actions, chooser, getGuard, refresh, request, runAction, sharedContent]
   );

   const forget = useCallback(
      async (folderId: SharedFolderId) => {
         if (busyRef.current) return;

         const guard = getGuard();
         const token = guard.next();
         busyRef.current = true;
         setState({ status: 'saving' });

         try {
            await runAction(
               token,
               () => sharedContent.forgetCustomFolder({ targetId: request.targetId, folderId }),
               async () => {
                  setState({ status: 'idle' });
                  await refresh();
               }
            );
         } finally {
            if (guard.isCurrent(token)) busyRef.current = false;
         }
      },
      [getGuard, refresh, request.targetId, runAction, sharedContent]
   );

   return { state, add, forget, dialog: chooser.dialog };
}
