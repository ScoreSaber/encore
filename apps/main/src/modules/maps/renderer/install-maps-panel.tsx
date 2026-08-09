import { useMemo, useState } from 'react';

import { ArrowDown, ArrowUp, Download, MoreHorizontal, Search, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MasterDetail, MasterDetailPane, MasterDetailRow, VirtualMasterDetailList } from '@/components/ui/master-detail';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { LocalMapSummary } from '@/modules/maps/contract';
import { MapActionDialog } from '@/modules/maps/renderer/map-action-dialog';
import { MapCoverImage } from '@/modules/maps/renderer/map-cover-image';
import { MapDetailPanel } from '@/modules/maps/renderer/map-detail-panel';
import { MapSearchDialog } from '@/modules/maps/renderer/map-search-dialog';
import type { InstallMaps } from '@/modules/maps/renderer/use-install-maps';
import { useMapActions } from '@/modules/maps/renderer/use-map-actions';
import { SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';
import { matchesQuery, selectionState } from '@/renderer/collection/view';

const mapSortSchema = z.enum(['title', 'mapper', 'size', 'date', 'bpm', 'duration']);

type MapSort = z.infer<typeof mapSortSchema>;
type SortDirection = 'ascending' | 'descending';

export function InstallMapsPanel({ request, maps }: { request: TargetMapCollectionRequest; maps: InstallMaps }) {
   const t = useTranslations('maps');
   const common = useTranslations('common');
   const actions = useMapActions(request, maps.clearSelection);
   const shared = useSharedFolder(request, 'maps');
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<'failed' | 'unsupported' | null>(null);
   const [searchOpen, setSearchOpen] = useState(false);
   const [query, setQuery] = useState('');
   const [sort, setSort] = useState<MapSort>('date');
   const [sortDirection, setSortDirection] = useState<SortDirection>('descending');
   const [activeMapId, setActiveMapId] = useState<string | null>(null);
   const { snapshot, status, selected } = maps;
   const busy = status === 'loading' || snapshot.status === 'scanning';
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () =>
         snapshot.maps
            .filter((map) => matchesQuery(filterText, [map.title, map.subTitle, map.artist, ...map.mappers, map.hash ?? '']))
            .toSorted((first, second) => compareMaps(first, second, sort, sortDirection)),
      [snapshot.maps, filterText, sort, sortDirection]
   );
   const visibleIds = visible.map((map) => map.id);
   const selectedVisible = visibleIds.filter((mapId) => selected.has(mapId)).length;
   const activeMap = snapshot.maps.find((map) => map.id === activeMapId) ?? null;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;
   const note = scanning ? t('scanning', { scanned: scanning.scanned, total: scanning.total }) : null;

   const openFolder = async (mapId: string) => {
      const opened = await actions.openFolder(mapId).then(
         (result) => result,
         () => null
      );
      setFolderResult(!opened || opened.status === 'failed' ? 'failed' : opened.status === 'unsupported' ? 'unsupported' : null);
   };

   if (status === 'loading' && snapshot.maps.length === 0) return <LoadingPanel />;
   if (snapshot.status === 'unsupported') return <EmptyPanel description={t('unsupportedTarget')} />;

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
         <CollectionToolbar
            leading={
               snapshot.maps.length > 1 ? (
                  <ButtonGroup aria-label={t('sort.label')}>
                     <Select value={sort} onValueChange={(value) => setSort(mapSortSchema.parse(value))}>
                        <SelectTrigger size="compact" className="h-8 min-w-28 rounded-r-none" aria-label={t('sort.label')}>
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="title">{t('sort.title')}</SelectItem>
                           <SelectItem value="mapper">{t('sort.mapper')}</SelectItem>
                           <SelectItem value="size">{t('sort.size')}</SelectItem>
                           <SelectItem value="date">{t('sort.date')}</SelectItem>
                           <SelectItem value="bpm">{t('sort.bpm')}</SelectItem>
                           <SelectItem value="duration">{t('sort.duration')}</SelectItem>
                        </SelectContent>
                     </Select>
                     <Tooltip>
                        <TooltipTrigger asChild>
                           <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              className="rounded-l-none"
                              aria-label={t(`sort.${sortDirection}`)}
                              onClick={() => setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'))}
                           >
                              {sortDirection === 'ascending' ? <ArrowUp /> : <ArrowDown />}
                           </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t(`sort.${sortDirection}`)}</TooltipContent>
                     </Tooltip>
                  </ButtonGroup>
               ) : null
            }
            filter={{ value: query, label: common('search'), onChange: setQuery }}
            note={note}
            rescan={{ label: common('rescan'), busy, onClick: maps.rescan }}
            menu={
               local ? (
                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={common('more')}>
                           <MoreHorizontal />
                        </Button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={busy} onSelect={() => void actions.importMaps()}>
                           <Upload />
                           {common('import')}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               ) : undefined
            }
            action={
               <Button type="button" variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
                  <Search data-icon="inline-start" />
                  {t('findMore')}
               </Button>
            }
         >
            {selected.size > 0 ? (
               <ButtonGroup aria-label={t('title')}>
                  {local ? (
                     <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void actions.exportMaps([...selected])}>
                        <Download data-icon="inline-start" />
                        {t('export', { count: selected.size })}
                     </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void actions.previewDelete([...selected])}>
                     <Trash2 data-icon="inline-start" />
                     {t('deleteSelected', { count: selected.size })}
                  </Button>
               </ButtonGroup>
            ) : null}
         </CollectionToolbar>

         <SharedFolderNotice shared={shared} />

         {snapshot.problems.map((problem) => (
            <WarningLine key={problem.code}>{problem.message}</WarningLine>
         ))}

         {status === 'error' ? <ErrorPanel message={t('loadError')} onRetry={maps.rescan} /> : null}
         {snapshot.status === 'missing' ? <EmptyPanel description={t('missing')} /> : null}
         {!busy && snapshot.status === 'ready' && snapshot.maps.length === 0 ? <EmptyPanel description={t('empty')} /> : null}

         {visible.length > 0 ? (
            <MasterDetail>
               <VirtualMasterDetailList
                  items={visible}
                  getItemId={(map) => map.id}
                  estimateSize={64}
                  selectedId={activeMapId}
                  onSelect={setActiveMapId}
                  aria-label={t('title')}
                  header={
                     <div className="bg-muted/20 text-muted-foreground sticky top-0 z-10 flex min-h-10 items-center gap-2 border-b px-3 py-2 text-xs backdrop-blur">
                        <Checkbox
                           aria-label={t('selectAll')}
                           checked={selectionState(selectedVisible, visible.length)}
                           onCheckedChange={() => maps.toggleAll(visibleIds)}
                        />
                        <span>{t('selectCount', { count: visible.length })}</span>
                     </div>
                  }
               >
                  {(map) => (
                     <MasterDetailRow id={map.id} aria-selected={map.id === activeMapId} className="min-h-16" onClick={() => setActiveMapId(map.id)}>
                        <Checkbox
                           checked={selected.has(map.id)}
                           disabled={busy}
                           aria-label={map.title}
                           onClick={(event) => event.stopPropagation()}
                           onCheckedChange={() => maps.toggle(map.id)}
                        />
                        <MapCoverImage request={request} map={map} className="size-12 rounded-sm border" />
                        <div className="min-w-0 flex-1 overflow-hidden">
                           <div className="flex min-w-0 items-center gap-1.5">
                              <p className="min-w-0 flex-1 truncate font-medium">
                                 {map.title}{' '}
                                 <span className="text-muted-foreground font-normal">
                                    {t('detail.byArtist', { artist: map.artist || t('detail.unknownArtist') })}
                                 </span>
                              </p>
                              {map.isDuplicate ? <Badge variant="secondary">{t('duplicate')}</Badge> : null}
                              {map.problem ? <Badge variant="destructive">{t('unreadable')}</Badge> : null}
                           </div>
                           <p className="text-muted-foreground mt-1 truncate text-xs">
                              {t('detail.mappedBy', { mappers: map.mappers.join(', ') || t('detail.unknownMapper') })}
                           </p>
                        </div>
                     </MasterDetailRow>
                  )}
               </VirtualMasterDetailList>

               <MasterDetailPane>
                  <MapDetailPanel
                     request={request}
                     map={activeMap}
                     disabled={busy}
                     folderResult={folderResult}
                     onDelete={(mapId) => void actions.previewDelete([mapId])}
                     onOpenFolder={local ? (mapId) => void openFolder(mapId) : undefined}
                  />
               </MasterDetailPane>
            </MasterDetail>
         ) : null}

         {snapshot.maps.length > 0 && visible.length === 0 ? <EmptyPanel description={t('noMatches')} /> : null}

         <MapActionDialog request={request} actions={actions} />
         {searchOpen ? (
            <MapSearchDialog
               request={request}
               onOpenChange={setSearchOpen}
               onDownload={(key) => {
                  setSearchOpen(false);
                  void actions.downloadMap({ kind: 'beatsaver', key });
               }}
            />
         ) : null}
      </div>
   );
}

function compareMaps(first: LocalMapSummary, second: LocalMapSummary, sort: MapSort, direction: SortDirection) {
   if (sort === 'title' || sort === 'mapper') {
      const left = sort === 'title' ? first.title : first.mappers.join(', ');
      const right = sort === 'title' ? second.title : second.mappers.join(', ');
      const compared = left.localeCompare(right);

      return (direction === 'ascending' ? compared : -compared) || first.title.localeCompare(second.title);
   }

   const left = numericSortValue(first, sort);
   const right = numericSortValue(second, sort);

   if (left === null && right === null) return first.title.localeCompare(second.title);
   if (left === null) return 1;
   if (right === null) return -1;

   const compared = left - right;
   return (direction === 'ascending' ? compared : -compared) || first.title.localeCompare(second.title);
}

function numericSortValue(map: LocalMapSummary, sort: Exclude<MapSort, 'title' | 'mapper'>) {
   if (sort === 'size') return map.sizeBytes;
   if (sort === 'date') return Date.parse(map.updatedAt);
   if (sort === 'bpm') return map.bpm;
   return map.durationSeconds;
}
