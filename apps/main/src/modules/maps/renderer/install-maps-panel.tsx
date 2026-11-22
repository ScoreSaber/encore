import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Result } from 'better-result';
import { ArrowDown, ArrowLeftRight, ArrowUp, Search, Upload } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { CollectionPanel } from '@/components/collection/collection-panel';
import { matchesQuery, selectionState, useCollectionSelection, type CollectionSelection } from '@/components/collection/selection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { MasterDetail, MasterDetailPane, MasterDetailRow, VirtualMasterDetailList } from '@/components/ui/master-detail';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import { createEmptyMapCollectionSnapshot, type LocalMapSummary, type MapCollectionSnapshot } from '@/modules/maps/contract';
import { MapActionDialog } from '@/modules/maps/renderer/map-action-dialog';
import { MapCoverImage } from '@/modules/maps/renderer/map-cover-image';
import { MapDetailPanel } from '@/modules/maps/renderer/map-detail-panel';
import { mapListQueryOptions } from '@/modules/maps/renderer/map-queries';
import { MapSearchDialog } from '@/modules/maps/renderer/map-search-dialog';
import { MapSyncDialog } from '@/modules/maps/renderer/map-sync-dialog';
import { useMapActions, type MapActions } from '@/modules/maps/renderer/use-map-actions';
import { SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';
import { useTargets } from '@/modules/targets/renderer/use-targets';
import { unwrapTarget } from '@/renderer/ipc-result';
import { queryStatus, type QueryStatus, useSnapshotMutation } from '@/renderer/query/api-query';

const mapSortSchema = z.enum(['title', 'mapper', 'size', 'date', 'bpm', 'duration']);

type MapSort = z.infer<typeof mapSortSchema>;
type SortDirection = 'ascending' | 'descending';

export function InstallMapsTab({ request, active }: { request: TargetMapCollectionRequest; active: boolean }) {
   const query = useQuery(mapListQueryOptions(request));
   const rescan = useSnapshotMutation(mapListQueryOptions(request).queryKey, async () => unwrapTarget(await window.encore.maps.rescan(request)));
   const selection = useCollectionSelection(`${request.targetId}\0${request.installId}`);
   const actions = useMapActions(request, selection.clear);
   const status = rescan.isPending ? 'loading' : queryStatus(query);
   const snapshot = query.data ?? createEmptyMapCollectionSnapshot(request);

   return (
      <>
         {active ? (
            <InstallMapsPanel
               request={request}
               snapshot={snapshot}
               status={status}
               selection={selection}
               actions={actions}
               onRescan={() => rescan.mutate()}
            />
         ) : null}
         <MapActionDialog request={request} actions={actions} />
      </>
   );
}

function InstallMapsPanel({
   request,
   snapshot,
   status,
   selection,
   actions,
   onRescan
}: {
   request: TargetMapCollectionRequest;
   snapshot: MapCollectionSnapshot;
   status: QueryStatus;
   selection: CollectionSelection;
   actions: MapActions;
   onRescan: () => void;
}) {
   const t = useTranslations('maps');
   const problems = useTranslations('problems.maps');
   const common = useTranslations('common');
   const shared = useSharedFolder(request, 'maps');
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<{ mapId: string; status: 'failed' | 'unsupported' } | null>(null);
   const [searchOpen, setSearchOpen] = useState(false);
   const [syncOpen, setSyncOpen] = useState(false);
   const { targets } = useTargets();
   const canSync =
      window.encore.runtime === 'desktop' && targets.some((target) => target.id !== request.targetId && target.capabilities.includes('manage-maps'));
   const [query, setQuery] = useState('');
   const [sort, setSort] = useState<MapSort>('date');
   const [sortDirection, setSortDirection] = useState<SortDirection>('descending');
   const [activeMapId, setActiveMapId] = useState<string | null>(null);
   const { maps } = snapshot;
   const { selected } = selection;
   const busy = status === 'loading' || snapshot.status === 'scanning' || actions.flow.busy;
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () =>
         maps
            .filter((map) => matchesQuery(filterText, [map.title, map.subTitle, map.artist, ...map.mappers, map.hash ?? '']))
            .toSorted((first, second) => compareMaps(first, second, sort, sortDirection)),
      [maps, filterText, sort, sortDirection]
   );
   const visibleIds = visible.map((map) => map.id);
   const selectedVisible = visibleIds.filter((mapId) => selected.has(mapId)).length;
   const activeMap = maps.find((map) => map.id === activeMapId) ?? null;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;

   const openFolder = async (mapId: string) => {
      const opened = await Result.tryPromise(() => actions.openFolder(mapId));
      setFolderResult(
         Result.isError(opened) ? { mapId, status: 'failed' } : opened.value.status === 'opened' ? null : { mapId, status: opened.value.status }
      );
   };

   return (
      <CollectionPanel
         status={status}
         snapshotStatus={snapshot.status}
         total={maps.length}
         visible={visible.length}
         query={query}
         onQueryChange={setQuery}
         onRescan={onRescan}
         labels={{
            unsupported: problems('unsupported-target'),
            missing: t('missing'),
            empty: t('empty'),
            noMatches: t('noMatches'),
            loadError: t('loadError'),
            note: scanning ? t('scanning', { scanned: scanning.scanned, total: scanning.total }) : null
         }}
         leading={
            maps.length > 1 ? (
               <div className="flex gap-1">
                  <Select value={sort} onValueChange={(value) => setSort(mapSortSchema.parse(value))}>
                     <SelectTrigger size="compact" className="h-8 min-w-28" aria-label={t('sort.label')}>
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        {mapSortSchema.options.map((option) => (
                           <SelectItem key={option} value={option}>
                              {t(`sort.${option}`)}
                           </SelectItem>
                        ))}
                     </SelectContent>
                  </Select>
                  <Tooltip>
                     <TooltipTrigger asChild>
                        <Button
                           type="button"
                           variant="ghost"
                           size="icon-sm"
                           aria-label={t(`sort.${sortDirection}`)}
                           onClick={() => setSortDirection((current) => (current === 'ascending' ? 'descending' : 'ascending'))}
                        >
                           {sortDirection === 'ascending' ? <ArrowUp /> : <ArrowDown />}
                        </Button>
                     </TooltipTrigger>
                     <TooltipContent>{t(`sort.${sortDirection}`)}</TooltipContent>
                  </Tooltip>
               </div>
            ) : null
         }
         menu={local ? { label: common('import'), icon: <Upload />, disabled: busy, onSelect: () => void actions.importMaps() } : null}
         action={
            <div className="flex items-center gap-2">
               {canSync ? (
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setSyncOpen(true)}>
                     <ArrowLeftRight data-icon="inline-start" />
                     {t('sync.action')}
                  </Button>
               ) : null}
               <Button type="button" variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
                  <Search data-icon="inline-start" />
                  {t('findMore')}
               </Button>
            </div>
         }
         selection={{
            count: selected.size,
            exportLabel: t('export', { count: selected.size }),
            deleteLabel: t('deleteSelected', { count: selected.size }),
            onExport: local ? () => void actions.exportMaps([...selected]) : null,
            onDelete: () => void actions.previewDelete([...selected])
         }}
         notices={<SharedFolderNotice shared={shared} />}
         problems={snapshot.problems.map((problem) => ({ key: problem.code, message: problem.message }))}
         dialogs={
            <>
               {syncOpen ? <MapSyncDialog current={request} onOpenChange={setSyncOpen} /> : null}
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
            </>
         }
      >
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
                        onCheckedChange={() => selection.toggleAll(visibleIds)}
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
                        onCheckedChange={() => selection.toggle(map.id)}
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
                  folderResult={activeMap && folderResult?.mapId === activeMap.id ? folderResult.status : null}
                  onDelete={(mapId) => void actions.previewDelete([mapId])}
                  onOpenFolder={local ? (mapId) => void openFolder(mapId) : undefined}
               />
            </MasterDetailPane>
         </MasterDetail>
      </CollectionPanel>
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
