import { useTranslations } from 'use-intl';

import { ContentLinkDialog } from '@/components/content/content-link-dialog';

import type { ModelLinkIssue } from '@/modules/models/contract';
import { useModelLink } from '@/modules/models/renderer/use-model-link';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { MessageKey } from '@/renderer/i18n/keys';

const issueKeys: Record<ModelLinkIssue, MessageKey<'models.link.issues'>> = {
   'invalid-id': 'invalidId',
   'unsupported-link': 'unsupportedLink'
};

export function ModelLinkDialog() {
   const t = useTranslations('models.link');
   const actions = useTranslations('models.actions');
   const common = useTranslations('common');
   const tabs = useTranslations('models.tabs');
   const link = useModelLink();
   const { state } = link;
   const source = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.source : null;

   return (
      <ContentLinkDialog
         state={state}
         operation={link.operation}
         destinations={link.destinations}
         selectedDestinationKey={link.selectedDestinationKey}
         selectDestination={link.selectDestination}
         confirm={link.confirm}
         cancel={link.cancel}
         dismiss={link.dismiss}
         hidden={link.dialogHidden}
         remember={{ checked: link.remember, label: common('rememberDownload'), onCheckedChange: link.setRemember }}
         issue={
            state.status === 'rejected' ? (
               <>
                  <p>{t(`issues.${issueKeys[state.issue]}`)}</p>
                  {state.detail ? <p className="text-muted-foreground text-xs break-all">{state.detail}</p> : null}
               </>
            ) : null
         }
         preview={
            source ? (
               <>
                  <PreviewRow label={t('model')} value={source.model ? source.model.name : t('unknownModel', { id: source.id })} />
                  {source.model ? <PreviewRow label={t('author')} value={source.model.author} /> : null}
                  {source.model ? <PreviewRow label={t('type')} value={tabs(source.model.type)} /> : null}
               </>
            ) : null
         }
         labels={{
            title: t('title'),
            description: t('description'),
            failed: actions('result.failed'),
            preparing: common('operation.preparing'),
            progress: (values) => common('operation.progress', values),
            completed: actions('result.completed'),
            cancelled: actions('result.cancelled'),
            noInstalls: t('noInstalls'),
            destination: t('destination'),
            confirm: t('confirm')
         }}
      />
   );
}
