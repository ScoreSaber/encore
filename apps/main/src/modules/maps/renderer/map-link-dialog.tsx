import { useTranslations } from 'use-intl';

import { ContentLinkDialog } from '@/components/content/content-link-dialog';

import type { MapLinkIssue } from '@/modules/maps/contract';
import { useMapLink } from '@/modules/maps/renderer/use-map-link';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { MessageKeyMap } from '@/renderer/i18n/keys';

const issueKeys: MessageKeyMap<MapLinkIssue, 'maps.link.issues'> = {
   'invalid-key': 'invalidKey',
   'unsupported-link': 'unsupportedLink'
};

export function MapLinkDialog() {
   const t = useTranslations('maps.link');
   const actions = useTranslations('maps.actions');
   const common = useTranslations('common');
   const link = useMapLink();
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
                  <PreviewRow label={t('map')} value={source.map ? source.map.title : t('unknownMap', { key: source.key })} />
                  {source.map ? <PreviewRow label={t('mapper')} value={source.map.mapper} /> : null}
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
