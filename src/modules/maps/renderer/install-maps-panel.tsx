import { useMemo, useState } from 'react';

import type { ColumnDef } from '@tanstack/react-table';
import { Download, FolderOpen, MoreHorizontal, Search, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { DateCell } from '@/components/collection/date-cell';
import { CopyPathContextMenu } from '@/components/copy-path-context-menu';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { matchesQuery, selectionState } from '@/app/renderer/collection/view';
import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import type { LocalMapSummary } from '@/modules/maps/contract';
import { MapActionDialog } from '@/modules/maps/renderer/map-action-dialog';
import { MapSearchDialog } from '@/modules/maps/renderer/map-search-dialog';
import type { InstallMaps } from '@/modules/maps/renderer/use-install-maps';
import { useMapActions } from '@/modules/maps/renderer/use-map-actions';
import { SharedFolderMenuItems, SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';

export function InstallMapsPanel({
   request,
   maps,
   onManageSharedContent
}: {
   request: TargetMapCollectionRequest;
   maps: InstallMaps;
   onManageSharedContent: () => void;
}) {
   const t = useTranslations('maps');
   const common = useTranslations('common');
   const format = useFormatters();
   const actions = useMapActions(request, maps.clearSelection);
   const shared = useSharedFolder(request, 'maps');
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<'failed' | 'unsupported' | null>(null);
   const [searchOpen, setSearchOpen] = useState(false);
   const [query, setQuery] = useState('');
   const { snapshot, status, selected } = maps;
   const busy = status === 'loading' || snapshot.status === 'scanning';
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () => snapshot.maps.filter((map) => matchesQuery(filterText, [map.title, map.artist, ...map.mappers])),
      [snapshot.maps, filterText]
   );
   const visibleIds = visible.map((map) => map.id);
   const selectedVisible = visibleIds.filter((mapId) => selected.has(mapId)).length;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;
   const note = scanning
      ? t('scanning', { scanned: scanning.scanned, total: scanning.total })
      : snapshot.maps.length === 0
        ? null
        : visible.length === snapshot.maps.length
          ? t('count', { count: snapshot.maps.length })
          : t('countFiltered', {
               visible: visible.length,
               total: snapshot.maps.length
            });

   const openFolder = async (mapId: string) => {
      const opened = await actions.openFolder(mapId).catch(() => null);
      setFolderResult(!opened || opened.status === 'failed' ? 'failed' : opened.status === 'unsupported' ? 'unsupported' : null);
   };

   const columns: ColumnDef<LocalMapSummary>[] = [
      {
         id: 'select',
         size: 40,
         enableResizing: false,
         meta: { control: true },
         header: () => (
            <Checkbox
               aria-label={t('selectAll')}
               checked={selectionState(selectedVisible, visible.length)}
               onCheckedChange={() => maps.toggleAll(visibleIds)}
            />
         ),
         cell: ({ row }) => (
            <Checkbox aria-label={row.original.title} checked={selected.has(row.original.id)} onCheckedChange={() => maps.toggle(row.original.id)} />
         )
      },
      {
         id: 'title',
         header: t('columns.title'),
         accessorFn: (map) => map.title,
         meta: { flex: true },
         cell: ({ row }) => (
            <>
               <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{row.original.title}</span>
                  {row.original.isDuplicate ? <Badge variant="secondary">{t('duplicate')}</Badge> : null}
                  {row.original.problem ? (
                     <Badge variant="destructive" aria-description={row.original.problem.message}>
                        {t('unreadable')}
                     </Badge>
                  ) : null}
               </div>
               <div className="text-muted-foreground truncate text-xs">{row.original.artist ?? ''}</div>
            </>
         )
      },
      {
         id: 'mapper',
         size: 176,
         header: t('columns.mapper'),
         accessorFn: (map) => map.mappers.join(', '),
         meta: { cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => row.original.mappers.join(', ')
      },
      {
         id: 'size',
         size: 96,
         header: t('columns.size'),
         accessorFn: (map) => map.sizeBytes,
         meta: {
            className: 'text-right',
            cellClassName: 'text-muted-foreground tabular-nums'
         },
         cell: ({ row }) => format.bytes(row.original.sizeBytes)
      },
      {
         id: 'date',
         size: 120,
         header: t('columns.date'),
         accessorFn: (map) => Date.parse(map.updatedAt),
         meta: { className: 'text-right', cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => <DateCell value={row.original.updatedAt} />
      },
      {
         id: 'actions',
         size: 48,
         enableResizing: false,
         meta: { className: 'text-right', control: true },
         cell: ({ row }) =>
            local ? (
               <CopyPathContextMenu pathType="path" value={row.original.path}>
                  <Button
                     type="button"
                     variant="ghost"
                     size="icon-sm"
                     aria-label={common('openFolder.action')}
                     onClick={() => void openFolder(row.original.id)}
                  >
                     <FolderOpen />
                  </Button>
               </CopyPathContextMenu>
            ) : null
      }
   ];

   if (snapshot.status === 'unsupported') return <EmptyPanel description={t('unsupportedTarget')} />;

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
         <CollectionToolbar
            label={t('title')}
            filter={snapshot.maps.length > 0 ? { value: query, label: t('filter'), onChange: setQuery } : null}
            note={note}
            rescan={{ label: common('rescan'), busy, onClick: maps.rescan }}
            menu={
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button type="button" variant="outline" size="icon-sm" aria-label={common('more')}>
                        <MoreHorizontal />
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     {local ? (
                        <DropdownMenuItem disabled={busy} onSelect={() => void actions.importMaps()}>
                           <Upload />
                           {common('import')}
                        </DropdownMenuItem>
                     ) : null}

                     <SharedFolderMenuItems separated={local} onManage={onManageSharedContent} />
                  </DropdownMenuContent>
               </DropdownMenu>
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

            <Button type="button" variant="outline" size="sm" onClick={() => setSearchOpen(true)}>
               <Search data-icon="inline-start" />
               {t('find')}
            </Button>
         </CollectionToolbar>

         <SharedFolderNotice shared={shared} />

         {snapshot.problems.map((problem) => (
            <WarningLine key={problem.code}>{problem.message}</WarningLine>
         ))}

         {folderResult ? <p className="text-muted-foreground text-xs">{common(`openFolder.${folderResult}`)}</p> : null}

         {status === 'error' ? <ErrorPanel message={t('loadError')} onRetry={maps.rescan} /> : null}

         {busy && snapshot.maps.length === 0 ? <LoadingPanel /> : null}

         {snapshot.status === 'missing' ? <EmptyPanel description={t('missing')} /> : null}

         {!busy && snapshot.status === 'ready' && snapshot.maps.length === 0 ? <EmptyPanel description={t('empty')} /> : null}

         {visible.length > 0 ? (
            <DataTable
               columns={columns}
               data={visible}
               getRowId={(map) => map.id}
               label={t('title')}
               tableId="maps"
               defaultSorting={[{ id: 'date', desc: true }]}
               rowHeight={52}
            />
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
