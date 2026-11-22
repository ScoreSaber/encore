import { Download } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CatalogSearchDialog, useCatalogSearch } from '@/components/collection/catalog-search';
import { Button } from '@/components/ui/button';
import { RemoteImage } from '@/components/ui/remote-image';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { BeatSaverMapSummary } from '@/modules/maps/contract';
import { supportLinkUrls } from '@/modules/support/contract';
import { unwrapTarget } from '@/renderer/ipc-result';
import { installKey } from '@/renderer/query/api-query';

export function MapSearchDialog({
   request,
   onOpenChange,
   onDownload
}: {
   request: TargetMapCollectionRequest;
   onOpenChange: (open: boolean) => void;
   onDownload: (key: string) => void;
}) {
   const t = useTranslations('maps.search');
   const search = useCatalogSearch(installKey('maps', request, 'search'), async (query, page) => {
      const result = unwrapTarget(await window.encore.maps.search({ ...request, query, page }));
      return result.status === 'ok' ? { status: 'ok', query: result.query, page: result.page, items: result.maps, hasMore: result.hasMore } : result;
   });

   return (
      <CatalogSearchDialog
         search={search}
         labels={{
            title: t('title'),
            description: t('description'),
            browse: t('browse'),
            placeholder: t('placeholder'),
            submit: t('submit'),
            empty: t('empty'),
            previous: t('previous'),
            next: t('next')
         }}
         browse={{ url: supportLinkUrls.beatsaver, open: () => void window.encore.support.openLink({ id: 'beatsaver' }) }}
         issue={(issue) => t(`issues.${issue}`)}
         itemKey={(map) => map.key}
         onOpenChange={onOpenChange}
      >
         {(map) => <SearchResultRow map={map} onDownload={() => onDownload(map.key)} />}
      </CatalogSearchDialog>
   );
}

function SearchResultRow({ map, onDownload }: { map: BeatSaverMapSummary; onDownload: () => void }) {
   const t = useTranslations('maps.search');

   return (
      <div className="flex items-center gap-3 rounded-md border p-2">
         {map.coverUrl ? <RemoteImage src={map.coverUrl} alt="" className="size-12 shrink-0 rounded-sm object-cover" /> : null}

         <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
               <span className="font-medium">{map.title}</span>
               {map.installed ? <span className="text-muted-foreground text-xs">{t('installed')}</span> : null}
               {map.ranked ? <span className="text-muted-foreground text-xs">{t('ranked')}</span> : null}
               {map.curated ? <span className="text-muted-foreground text-xs">{t('curated')}</span> : null}
            </div>
            <div className="text-muted-foreground truncate text-xs">{t('by', { mapper: map.mapper, artist: map.artist })}</div>
         </div>

         <Button type="button" size="sm" disabled={map.installed} onClick={onDownload}>
            <Download data-icon="inline-start" />
            {t('download')}
         </Button>
      </div>
   );
}
