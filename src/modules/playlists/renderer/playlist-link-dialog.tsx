import { useTranslations } from 'use-intl';

import { ContentLinkDialog } from '@/components/content/content-link-dialog';

import type { MessageKey } from '@/app/renderer/i18n/keys';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { PlaylistLinkIssue } from '@/modules/playlists/contract';
import { usePlaylistLink } from '@/modules/playlists/renderer/use-playlist-link';

const issueKeys: Record<PlaylistLinkIssue, MessageKey<'playlists.link.issues'>> = {
   'invalid-source': 'invalidSource',
   'unsupported-link': 'unsupportedLink'
};

export function PlaylistLinkDialog() {
   const t = useTranslations('playlists.link');
   const actions = useTranslations('playlists.actions');
   const common = useTranslations('common');
   const link = usePlaylistLink();
   const { state } = link;
   const source = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.source : null;

   return (
      <ContentLinkDialog
         state={state}
         operation={link.operation}
         installs={link.installs}
         selectedInstallKey={link.selectedInstallKey}
         selectInstall={link.selectInstall}
         confirm={link.confirm}
         cancel={link.cancel}
         dismiss={link.dismiss}
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
               <PreviewRow label={t(source.kind === 'url' ? 'address' : 'file')} value={source.kind === 'url' ? source.url : source.fileName} />
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
            install: t('install'),
            confirm: t('confirm')
         }}
      />
   );
}
