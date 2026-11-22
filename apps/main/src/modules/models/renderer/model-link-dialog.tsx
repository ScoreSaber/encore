import { useTranslations } from 'use-intl';

import { createProblem } from '@/lib/errors';
import { modelSharedFolderIds, type ModelLinkEvent } from '@/modules/models/contract';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { ContentLinkDialog } from '@/modules/shared-content/renderer/content-link-dialog';
import { useContentLink, type ContentLinkPreset } from '@/modules/shared-content/renderer/use-content-link';

const modelLink: ContentLinkPreset<ModelLinkEvent, Extract<ModelLinkEvent, { status: 'ready' }>, Extract<ModelLinkEvent, { status: 'rejected' }>> = {
   client: window.encore.models,
   capability: 'manage-models',
   read: (event) => (event.status === 'rejected' ? { problem: event } : { source: event }),
   sharedFolderIds: (source) => {
      const folderId = source.model ? modelSharedFolderIds[source.model.type] : null;
      return folderId ? [folderId] : [];
   },
   start: (source, targetId, installId) => window.encore.models.startDownload({ targetId, installId, source: { kind: 'modelsaber', id: source.id } }),
   failures: {
      start: createProblem('models.start-failed'),
      pending: createProblem('models.link-intake-failed')
   }
};

export function ModelLinkDialog() {
   const t = useTranslations('models.link');
   const actions = useTranslations('models.actions');
   const tabs = useTranslations('models.tabs');
   const link = useContentLink(modelLink, t('success'));

   return (
      <ContentLinkDialog
         link={link}
         issue={(problem) => t(`issues.${problem.issue}`)}
         preview={(source) => (
            <>
               <PreviewRow label={t('model')} value={source.model ? source.model.name : t('unknownModel', { id: source.id })} />
               {source.model ? <PreviewRow label={t('author')} value={source.model.author} /> : null}
               {source.model ? <PreviewRow label={t('type')} value={tabs(source.model.type)} /> : null}
            </>
         )}
         labels={{
            title: t('title'),
            description: t('description'),
            failed: actions('result.failed'),
            completed: actions('result.completed'),
            cancelled: actions('result.cancelled'),
            noInstalls: t('noInstalls'),
            destination: t('destination'),
            confirm: t('confirm')
         }}
      />
   );
}
