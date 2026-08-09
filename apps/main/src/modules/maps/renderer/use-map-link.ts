import { useCallback, useEffect } from 'react';

import { useContentLink } from '@/components/content/use-content-link';

import type { BeatSaverMapSummary, MapLinkIssue } from '@/modules/maps/contract';

type MapLinkSource = { key: string; map: BeatSaverMapSummary | null };

export function useMapLink() {
   const maps = window.encore.maps;
   const { accept, reject, startTarget, ...link } = useContentLink<MapLinkSource, MapLinkIssue>('manage-maps');

   useEffect(() => {
      return maps.onLinkOpened((event) => {
         if (event.status === 'rejected') {
            reject(event.issue, event.detail);
         } else {
            accept({ key: event.key, map: event.map });
         }
      });
   }, [accept, maps, reject]);

   const confirm = useCallback(async () => {
      await startTarget(
         (source, targetId, installId) =>
            maps.startDownload({
               targetId,
               installId,
               source: { kind: 'beatsaver', key: source.key }
            }),
         {
            code: 'maps.start-failed',
            message: 'the download could not be started'
         }
      );
   }, [maps, startTarget]);

   return { ...link, confirm };
}
