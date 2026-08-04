import { useCallback, useEffect } from 'react';

import { useContentLink } from '@/components/content/use-content-link';

import type { ModelLinkIssue, ModelSaberModelSummary } from '@/modules/models/contract';

type ModelLinkSource = { id: string; model: ModelSaberModelSummary | null };

export function useModelLink() {
   const models = window.encore.models;
   const { accept, reject, startTarget, ...link } = useContentLink<ModelLinkSource, ModelLinkIssue>('manage-models');

   useEffect(() => {
      return models.onLinkOpened((event) => {
         if (event.status === 'rejected') {
            reject(event.issue, event.detail);
         } else {
            accept({ id: event.id, model: event.model });
         }
      });
   }, [accept, models, reject]);

   const confirm = useCallback(async () => {
      await startTarget(
         (source, targetId, installId) =>
            models.startDownload({
               targetId,
               installId,
               source: { kind: 'modelsaber', id: source.id }
            }),
         {
            code: 'models.start-failed',
            message: 'the download could not be started'
         }
      );
   }, [models, startTarget]);

   return { ...link, confirm };
}
