import { useMemo, useState } from 'react';

import type { ColumnDef } from '@tanstack/react-table';
import { Download, FolderOpen, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionToolbar } from '@/components/collection/collection-toolbar';
import { DateCell } from '@/components/collection/date-cell';
import { EmptyPanel, ErrorPanel, LoadingPanel, WarningLine } from '@/components/state/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

import { matchesQuery, selectionState } from '@/app/renderer/collection/view';
import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import type { LocalPlaylistSummary, PlaylistId } from '@/modules/playlists/contract';
import { PlaylistActionDialog } from '@/modules/playlists/renderer/playlist-action-dialog';
import { PlaylistAddDialog } from '@/modules/playlists/renderer/playlist-add-dialog';
import { PlaylistDetailDialog } from '@/modules/playlists/renderer/playlist-detail-dialog';
import type { InstallPlaylists } from '@/modules/playlists/renderer/use-install-playlists';
import { usePlaylistActions } from '@/modules/playlists/renderer/use-playlist-actions';
import { SharedFolderMenuItems, SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';

export function InstallPlaylistsPanel({
   request,
   playlists,
   onManageSharedContent
}: {
   request: TargetPlaylistCollectionRequest;
   playlists: InstallPlaylists;
   onManageSharedContent: () => void;
}) {
   const t = useTranslations('playlists');
   const common = useTranslations('common');
   const format = useFormatters();
   const actions = usePlaylistActions(request, playlists.clearSelection);
   const shared = useSharedFolder(request, 'playlists');
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<'failed' | 'unsupported' | null>(null);
   const [addOpen, setAddOpen] = useState(false);
   const [detailId, setDetailId] = useState<PlaylistId | null>(null);
   const [query, setQuery] = useState('');
   const { snapshot, status, selected } = playlists;
   const busy = status === 'loading' || snapshot.status === 'scanning';
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () => snapshot.playlists.filter((playlist) => matchesQuery(filterText, [playlist.title, playlist.author, playlist.fileName])),
      [snapshot.playlists, filterText]
   );
   const visibleIds = visible.map((playlist) => playlist.id);
   const selectedVisible = visibleIds.filter((playlistId) => selected.has(playlistId)).length;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;
   const note = scanning
      ? t('scanning', { scanned: scanning.scanned, total: scanning.total })
      : snapshot.playlists.length === 0
        ? null
        : visible.length === snapshot.playlists.length
          ? t('count', { count: snapshot.playlists.length })
          : t('countFiltered', { visible: visible.length, total: snapshot.playlists.length });

   const openFolder = async () => {
      const opened = await actions.openFolder().catch(() => null);
      setFolderResult(!opened || opened.status === 'failed' ? 'failed' : opened.status === 'unsupported' ? 'unsupported' : null);
   };

   const columns: ColumnDef<LocalPlaylistSummary>[] = [
      {
         id: 'select',
         size: 40,
         enableResizing: false,
         meta: { control: true },
         header: () => (
            <Checkbox
               aria-label={t('selectAll')}
               checked={selectionState(selectedVisible, visible.length)}
               onCheckedChange={() => playlists.toggleAll(visibleIds)}
            />
         ),
         cell: ({ row }) => (
            <Checkbox
               aria-label={row.original.title}
               checked={selected.has(row.original.id)}
               onClick={(event) => event.stopPropagation()}
               onCheckedChange={() => playlists.toggle(row.original.id)}
            />
         )
      },
      {
         id: 'title',
         header: t('columns.title'),
         accessorFn: (playlist) => playlist.title,
         meta: { flex: true },
         cell: ({ row }) => (
            <div className="flex items-center gap-2">
               <button
                  type="button"
                  className="truncate text-left font-medium hover:underline"
                  onClick={(event) => {
                     event.stopPropagation();
                     setDetailId(row.original.id);
                  }}
               >
                  {row.original.title}
               </button>
               {row.original.problem ? (
                  <Badge variant="destructive" aria-description={row.original.problem.message}>
                     {t('unreadable')}
                  </Badge>
               ) : null}
            </div>
         )
      },
      {
         id: 'author',
         size: 160,
         header: t('columns.author'),
         accessorFn: (playlist) => playlist.author,
         meta: { cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => row.original.author
      },
      {
         id: 'songs',
         size: 88,
         header: t('columns.songs'),
         accessorFn: (playlist) => playlist.songCount,
         meta: { className: 'text-right', cellClassName: 'text-muted-foreground tabular-nums' },
         cell: ({ row }) => row.original.songCount
      },
      {
         id: 'missing',
         size: 96,
         header: t('columns.missing'),
         accessorFn: (playlist) => playlist.missingCount,
         meta: { className: 'text-right', cellClassName: 'text-status-warning tabular-nums' },
         cell: ({ row }) => (row.original.missingCount > 0 ? row.original.missingCount : null)
      },
      {
         id: 'size',
         size: 96,
         header: t('columns.size'),
         accessorFn: (playlist) => playlist.sizeBytes,
         meta: { className: 'text-right', cellClassName: 'text-muted-foreground tabular-nums' },
         cell: ({ row }) => format.bytes(row.original.sizeBytes)
      },
      {
         id: 'date',
         size: 120,
         header: t('columns.date'),
         accessorFn: (playlist) => Date.parse(playlist.updatedAt),
         meta: { className: 'text-right', cellClassName: 'text-muted-foreground' },
         cell: ({ row }) => <DateCell value={row.original.updatedAt} />
      }
   ];

   if (snapshot.status === 'unsupported') return <EmptyPanel description={t('unsupportedTarget')} />;

   return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 text-sm">
         <CollectionToolbar
            label={t('title')}
            filter={snapshot.playlists.length > 0 ? { value: query, label: t('filter'), onChange: setQuery } : null}
            note={note}
            rescan={{ label: common('rescan'), busy, onClick: playlists.rescan }}
            menu={
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <Button type="button" variant="outline" size="icon-sm" aria-label={common('more')}>
                        <MoreHorizontal />
                     </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                     {local ? (
                        <>
                           <DropdownMenuItem onSelect={() => void openFolder()}>
                              <FolderOpen />
                              {common('openFolder.action')}
                           </DropdownMenuItem>
                        </>
                     ) : null}

                     <SharedFolderMenuItems separated={local} onManage={onManageSharedContent} />
                  </DropdownMenuContent>
               </DropdownMenu>
            }
         >
            {selected.size > 0 ? (
               <ButtonGroup aria-label={t('title')}>
                  {local ? (
                     <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void actions.exportPlaylists([...selected])}>
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

            <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
               <Plus data-icon="inline-start" />
               {t('add.action')}
            </Button>
         </CollectionToolbar>

         <SharedFolderNotice shared={shared} />

         {snapshot.problems.map((problem) => (
            <WarningLine key={problem.code}>{problem.message}</WarningLine>
         ))}

         {folderResult ? <p className="text-muted-foreground text-xs">{common(`openFolder.${folderResult}`)}</p> : null}

         {status === 'error' ? <ErrorPanel message={t('loadError')} onRetry={playlists.rescan} /> : null}

         {busy && snapshot.playlists.length === 0 ? <LoadingPanel /> : null}

         {snapshot.status === 'missing' ? <EmptyPanel description={t('missing')} /> : null}

         {!busy && snapshot.status === 'ready' && snapshot.playlists.length === 0 ? <EmptyPanel description={t('empty')} /> : null}

         {visible.length > 0 ? (
            <DataTable
               columns={columns}
               data={visible}
               getRowId={(playlist) => playlist.id}
               label={t('title')}
               tableId="playlists"
               rowProps={(playlist) => ({ className: 'cursor-pointer', onClick: () => setDetailId(playlist.id) })}
            />
         ) : null}

         {snapshot.playlists.length > 0 && visible.length === 0 ? <EmptyPanel description={t('noMatches')} /> : null}

         <PlaylistActionDialog request={request} actions={actions} />
         <PlaylistAddDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            onBrowse={
               local
                  ? () => {
                       setAddOpen(false);
                       void actions.importPlaylists();
                    }
                  : undefined
            }
            onDownload={(url) => {
               setAddOpen(false);
               void actions.downloadPlaylist(url);
            }}
         />
         <PlaylistDetailDialog
            request={request}
            playlistId={detailId}
            onOpenChange={(open) => {
               if (!open) setDetailId(null);
            }}
            onInstallMissing={(playlistId) => {
               setDetailId(null);
               void actions.installMissingMaps(playlistId);
            }}
         />
      </div>
   );
}
