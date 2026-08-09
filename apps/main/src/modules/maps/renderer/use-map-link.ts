import { useCallback } from 'react';

import { useTranslations } from 'use-intl';

import { useContentLinkDownload } from '@/components/content/use-content-link';
import { usePendingLinkEvent } from '@/components/content/use-pending-link-event';

import type { InstallId } from '@/modules/installs/contract';
import type { BeatSaverMapSummary, MapLinkEvent, MapLinkIssue } from '@/modules/maps/contract';
import type { TargetId } from '@/modules/targets/contract';

type MapLinkSource = { key: string; map: BeatSaverMapSummary | null };

const pendingLinkFailure = {
   code: 'maps.link-intake-failed',
   message: 'failed to read the pending map link'
};
const startFailure = {
   code: 'maps.start-failed',
   message: 'the download could not be started'
};

export function useMapLink() {
   const t = useTranslations('maps.link');
   const maps = window.encore.maps;
   const start = useCallback(
      (source: MapLinkSource, targetId: TargetId, installId: InstallId) =>
         maps.startDownload({
            targetId,
            installId,
            source: { kind: 'beatsaver', key: source.key }
         }),
      [maps]
   );
   const link = useContentLinkDownload<MapLinkSource, MapLinkIssue>('manage-maps', {
      start,
      startFailure,
      successMessage: t('success'),
      sharedFolderIds: () => ['maps']
   });
   const open = useCallback(
      (event: MapLinkEvent) => {
         if (event.status === 'rejected') {
            link.reject(event.issue, event.detail);
         } else {
            link.accept({ key: event.key, map: event.map });
         }
      },
      [link.accept, link.reject]
   );

   usePendingLinkEvent(maps, open, link.fail, pendingLinkFailure);

   return link;
}
