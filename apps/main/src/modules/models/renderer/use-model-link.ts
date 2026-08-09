import { useCallback } from 'react';

import { useTranslations } from 'use-intl';

import { useContentLinkDownload } from '@/components/content/use-content-link';
import { usePendingLinkEvent } from '@/components/content/use-pending-link-event';

import type { InstallId } from '@/modules/installs/contract';
import { modelSharedFolderIds, type ModelLinkEvent, type ModelLinkIssue, type ModelSaberModelSummary } from '@/modules/models/contract';
import type { TargetId } from '@/modules/targets/contract';

type ModelLinkSource = { id: string; model: ModelSaberModelSummary | null };

const pendingLinkFailure = {
   code: 'models.link-intake-failed',
   message: 'failed to read the pending model link'
};
const startFailure = {
   code: 'models.start-failed',
   message: 'the download could not be started'
};

export function useModelLink() {
   const t = useTranslations('models.link');
   const models = window.encore.models;
   const start = useCallback(
      (source: ModelLinkSource, targetId: TargetId, installId: InstallId) =>
         models.startDownload({
            targetId,
            installId,
            source: { kind: 'modelsaber', id: source.id }
         }),
      [models]
   );
   const link = useContentLinkDownload<ModelLinkSource, ModelLinkIssue>('manage-models', {
      start,
      startFailure,
      successMessage: t('success'),
      sharedFolderIds: (source) => {
         const folderId = source.model ? modelSharedFolderIds[source.model.type] : null;

         return folderId ? [folderId] : [];
      }
   });
   const open = useCallback(
      (event: ModelLinkEvent) => {
         if (event.status === 'rejected') {
            link.reject(event.issue, event.detail);
         } else {
            link.accept({ id: event.id, model: event.model });
         }
      },
      [link.accept, link.reject]
   );

   usePendingLinkEvent(models, open, link.fail, pendingLinkFailure);

   return link;
}
