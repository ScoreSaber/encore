import { Download, ExternalLink, Search } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RemoteImage } from '@/components/ui/remote-image';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { BeatSaverMapSummary, MapSearchIssue } from '@/modules/maps/contract';
import { useMapSearch } from '@/modules/maps/renderer/use-map-search';
import { supportLinkUrls } from '@/modules/support/contract';
import type { MessageKey } from '@/renderer/i18n/keys';

const issueKeys: Record<MapSearchIssue, MessageKey<'maps.search.issues'>> = {
   'fetch-failed': 'fetchFailed',
   'invalid-response': 'invalidResponse',
   unsupported: 'unsupported'
};

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
   const common = useTranslations('common');
   const search = useMapSearch(request);
   const { state } = search;

   return (
      <Dialog open onOpenChange={onOpenChange}>
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <div className="flex items-baseline gap-3">
                  <DialogTitle>{t('title')}</DialogTitle>
                  <CopyPathContextMenu pathType="url" value={supportLinkUrls.beatsaver}>
                     <Button
                        type="button"
                        variant="link"
                        className="text-muted-foreground h-auto p-0 text-xs font-normal"
                        onClick={() => void window.encore.support.openLink({ id: 'beatsaver' })}
                     >
                        {t('browse')}
                        <ExternalLink className="size-3" />
                     </Button>
                  </CopyPathContextMenu>
               </div>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <form
               onSubmit={(event) => {
                  event.preventDefault();
                  void search.submit();
               }}
            >
               <div className="flex gap-2">
                  <Input
                     value={search.query}
                     placeholder={t('placeholder')}
                     aria-label={t('placeholder')}
                     onChange={(event) => search.setQuery(event.target.value)}
                  />
                  <Button type="submit" disabled={state.status === 'searching'}>
                     <Search data-icon="inline-start" />
                     {t('submit')}
                  </Button>
               </div>
            </form>

            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
               {state.status === 'searching' ? <LoadingPanel /> : null}

               {state.status === 'failed' ? (
                  <ErrorPanel message={t(`issues.${issueKeys[state.issue]}`)} detail={state.detail} onRetry={search.submit} />
               ) : null}

               {state.status === 'ready' && state.maps.length === 0 ? <EmptyPanel description={t('empty')} /> : null}

               {state.status === 'ready'
                  ? state.maps.map((map) => <SearchResultRow key={map.key} map={map} onDownload={() => onDownload(map.key)} />)
                  : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <ButtonGroup className="mr-auto" aria-label={`${t('previous')} / ${t('next')}`}>
                     <Button type="button" variant="outline" size="sm" disabled={state.page === 0} onClick={() => search.goToPage(state.page - 1)}>
                        {t('previous')}
                     </Button>
                     <Button type="button" variant="outline" size="sm" disabled={!state.hasMore} onClick={() => search.goToPage(state.page + 1)}>
                        {t('next')}
                     </Button>
                  </ButtonGroup>
               ) : null}

               <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
                  {common('close')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
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
