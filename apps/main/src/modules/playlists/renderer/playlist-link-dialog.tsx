import { useTranslations } from 'use-intl';

import { createProblem } from '@/lib/errors';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { PlaylistLinkEvent, PlaylistLinkSource } from '@/modules/playlists/contract';
import { ContentLinkDialog } from '@/modules/shared-content/renderer/content-link-dialog';
import { useContentLink, type ContentLinkPreset } from '@/modules/shared-content/renderer/use-content-link';
import { localTargetId } from '@/modules/targets/contract';

const playlistLink: ContentLinkPreset<PlaylistLinkEvent, PlaylistLinkSource, Extract<PlaylistLinkEvent, { status: 'rejected' }>> = {
   client: window.encore.playlists,
   capability: 'manage-playlists',
   read: (event) => (event.status === 'rejected' ? { problem: event } : { source: event.source }),
   sharedFolderIds: () => ['playlists'],
   supportsTarget: (source, target) => source.kind === 'url' || target.id === localTargetId,
   start: (source, targetId, installId) =>
      source.kind === 'url'
         ? window.encore.playlists.startDownload({ targetId, installId, url: source.url })
         : window.encore.playlists.importPlaylists({ targetId, installId, paths: [source.path] }),
   failures: {
      start: createProblem('playlists.start-failed'),
      pending: createProblem('playlists.link-intake-failed')
   }
};

export function PlaylistLinkDialog() {
   const t = useTranslations('playlists.link');
   const actions = useTranslations('playlists.actions');
   const link = useContentLink(playlistLink, t('success'));

   return (
      <ContentLinkDialog
         link={link}
         issue={(problem) => t(`issues.${problem.issue}`)}
         preview={(source) => (
            <PreviewRow label={t(source.kind === 'url' ? 'address' : 'file')} value={source.kind === 'url' ? source.url : source.fileName} />
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
