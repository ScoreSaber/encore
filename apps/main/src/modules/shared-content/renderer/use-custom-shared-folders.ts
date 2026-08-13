import { useCallback, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { TargetCallResult } from '@/lib/api';
import { causeFailure } from '@/lib/errors';
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
   const [state, setState] = useState<CustomSharedFoldersState>({ status: 'idle' });

   const runAction = useCallback(
      async (action: () => Promise<TargetCallResult<CustomSharedFolderActionResult>>, complete: (folder: CustomSharedFolder) => Promise<void>) => {
         const answered = await Result.tryPromise({
            try: action,
            catch: (cause) => causeFailure('failed to save the custom folder', cause)
         });
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
      []
   );

   const refresh = useCallback(async () => {
      await Promise.all([
         queryClient.invalidateQueries({ queryKey: sharedContentListQueryOptions(request).queryKey }),
         queryClient.invalidateQueries({ queryKey: sharedContentOverviewQueryOptions(request.targetId).queryKey })
      ]);
   }, [queryClient, request]);

   const add = useCallback(async () => {
      setState({ status: 'choosing' });
      const chosen = await Result.tryPromise({
         try: () => sharedContent.chooseCustomFolder(request),
         catch: (cause) => causeFailure('failed to open the custom folder picker', cause)
      });
      if (Result.isError(chosen)) {
         setState({ status: 'invalid', issue: 'choose-failed', detail: chosen.error });
         return;
      }
      const choice = chosen.value;
      if (choice.status === 'cancelled') {
         setState({ status: 'idle' });
         return;
      }
      if (choice.status === 'unsupported') {
         setState({ status: 'invalid', issue: 'unsupported-target' });
         return;
      }
      if (choice.status === 'invalid') {
         const invalid: CustomSharedFoldersState = { status: 'invalid', issue: choice.issue };
         if (choice.detail) invalid.detail = choice.detail;
         setState(invalid);
         return;
      }

      setState({ status: 'saving' });
      await runAction(
         () => sharedContent.addCustomFolder({ ...request, relativePath: choice.relativePath }),
         async (folder) => {
            setState({ status: 'idle' });
            await refresh();
            await actions.preview('link', folder.id);
         }
      );
   }, [actions, refresh, request, runAction, sharedContent]);

   const forget = useCallback(
      async (folderId: SharedFolderId) => {
         setState({ status: 'saving' });
         await runAction(
            () => sharedContent.forgetCustomFolder({ targetId: request.targetId, folderId }),
            async () => {
               setState({ status: 'idle' });
               await refresh();
            }
         );
      },
      [refresh, request.targetId, runAction, sharedContent]
   );

   return { state, add, forget };
}
