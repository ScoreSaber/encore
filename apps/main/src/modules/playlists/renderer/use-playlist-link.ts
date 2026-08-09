import { useCallback } from 'react';

import { useTranslations } from 'use-intl';

import { useContentLinkDownload } from '@/components/content/use-content-link';
import { usePendingLinkEvent } from '@/components/content/use-pending-link-event';

import type { TargetCallResult } from '@/lib/api';
import type { InstallId } from '@/modules/installs/contract';
import type { PlaylistLinkEvent, PlaylistLinkIssue, PlaylistLinkSource, PlaylistOperationResult } from '@/modules/playlists/contract';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

const pendingLinkFailure = {
   code: 'playlists.link-intake-failed',
   message: 'failed to read the pending playlist link'
};
const startFailure = {
   code: 'playlists.start-failed',
   message: 'the playlist could not be added'
};

export function usePlaylistLink() {
   const t = useTranslations('playlists.link');
   const playlists = window.encore.playlists;
   const start = useCallback(
      async (source: PlaylistLinkSource, targetId: TargetId, installId: InstallId): Promise<TargetCallResult<PlaylistOperationResult>> => {
         if (source.kind === 'url')
            return playlists.startDownload({
               targetId,
               installId,
               url: source.url
            });

         return {
            targetId,
            status: 'ok',
            value: await playlists.importPlaylists({
               targetId,
               installId,
               paths: [source.path]
            })
         };
      },
      [playlists]
   );
   const link = useContentLinkDownload<PlaylistLinkSource, PlaylistLinkIssue>('manage-playlists', {
      start,
      startFailure,
      successMessage: t('success'),
      sharedFolderIds: () => ['playlists'],
      supportsTarget: (source, target) => source.kind === 'url' || target.id === localTargetId
   });
   const open = useCallback(
      (event: PlaylistLinkEvent) => {
         if (event.status === 'rejected') {
            link.reject(event.issue, event.detail);
         } else {
            link.accept(event.source);
         }
      },
      [link.accept, link.reject]
   );

   usePendingLinkEvent(playlists, open, link.fail, pendingLinkFailure);

   return link;
}
