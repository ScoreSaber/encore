import { useTranslations } from 'use-intl';

import { createProblem } from '@/lib/errors';
import type { BeatSaverMapSummary, MapLinkEvent } from '@/modules/maps/contract';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { ContentLinkDialog } from '@/modules/shared-content/renderer/content-link-dialog';
import { useContentLink, type ContentLinkPreset } from '@/modules/shared-content/renderer/use-content-link';

const mapLink: ContentLinkPreset<MapLinkEvent, { key: string; map: BeatSaverMapSummary | null }, Extract<MapLinkEvent, { status: 'rejected' }>> = {
   client: window.encore.maps,
   capability: 'manage-maps',
   read: (event) => (event.status === 'rejected' ? { problem: event } : { source: { key: event.key, map: event.map } }),
   sharedFolderIds: () => ['maps'],
   start: (source, targetId, installId) => window.encore.maps.startDownload({ targetId, installId, source: { kind: 'beatsaver', key: source.key } }),
   failures: {
      start: createProblem('maps.start-failed'),
      pending: createProblem('maps.link-intake-failed')
   }
};

export function MapLinkDialog() {
   const t = useTranslations('maps.link');
   const actions = useTranslations('maps.actions');
   const link = useContentLink(mapLink, t('success'));

   return (
      <ContentLinkDialog
         link={link}
         issue={(problem) => t(`issues.${problem.issue}`)}
         preview={(source) => (
            <>
               <PreviewRow label={t('map')} value={source.map ? source.map.title : t('unknownMap', { key: source.key })} />
               {source.map ? <PreviewRow label={t('mapper')} value={source.map.mapper} /> : null}
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
