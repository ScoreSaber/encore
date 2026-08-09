import { useCallback, useEffect } from 'react';

import { useContentLink } from '@/components/content/use-content-link';

import type { PlaylistLinkIssue, PlaylistLinkSource } from '@/modules/playlists/contract';
import { localTargetId } from '@/modules/targets/contract';

export function usePlaylistLink() {
   const playlists = window.encore.playlists;
   const { accept, reject, startTarget, ...link } = useContentLink<PlaylistLinkSource, PlaylistLinkIssue>(
      'manage-playlists',
      (source, target) => source.kind === 'url' || target.id === localTargetId
   );

   useEffect(() => {
      return playlists.onLinkOpened((event) => {
         if (event.status === 'rejected') {
            reject(event.issue, event.detail);
         } else {
            accept(event.source);
         }
      });
   }, [accept, playlists, reject]);

   const confirm = useCallback(async () => {
      await startTarget(
         async (source, targetId, installId) => {
            if (source.kind === 'url') return playlists.startDownload({ targetId, installId, url: source.url });

            return {
               targetId,
               status: 'ok',
               value: await playlists.importPlaylists({ targetId, installId, paths: [source.path] })
            };
         },
         { code: 'playlists.start-failed', message: 'the playlist could not be added' }
      );
   }, [playlists, startTarget]);

   return { ...link, confirm };
}
