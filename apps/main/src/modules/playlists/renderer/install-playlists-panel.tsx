import { useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Result } from 'better-result';
import { FolderOpen, Plus } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { CollectionPanel } from '@/components/collection/collection-panel';
import { DateCell } from '@/components/collection/date-cell';
import { matchesQuery, selectionState, useCollectionSelection, type CollectionSelection } from '@/components/collection/selection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';

import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import {
   createEmptyPlaylistCollectionSnapshot,
   type LocalPlaylistSummary,
   type PlaylistCollectionSnapshot,
   type PlaylistId
} from '@/modules/playlists/contract';
import { PlaylistActionDialog } from '@/modules/playlists/renderer/playlist-action-dialog';
import { PlaylistAddDialog } from '@/modules/playlists/renderer/playlist-add-dialog';
import { PlaylistDetailDialog } from '@/modules/playlists/renderer/playlist-detail-dialog';
import { playlistListQueryOptions } from '@/modules/playlists/renderer/playlist-queries';
import { usePlaylistActions, type PlaylistActions } from '@/modules/playlists/renderer/use-playlist-actions';
import { SharedFolderNotice, useSharedFolder } from '@/modules/shared-content/renderer/shared-folder-menu';
import { localTargetId } from '@/modules/targets/contract';
import { useFormatters } from '@/renderer/i18n/formatters';
import { unwrapTarget } from '@/renderer/ipc-result';
import { queryStatus, type QueryStatus, useSnapshotMutation } from '@/renderer/query/api-query';

export function InstallPlaylistsTab({ request, active }: { request: TargetPlaylistCollectionRequest; active: boolean }) {
   const query = useQuery(playlistListQueryOptions(request));
   const rescan = useSnapshotMutation(playlistListQueryOptions(request).queryKey, async () =>
      unwrapTarget(await window.encore.playlists.rescan(request))
   );
   const selection = useCollectionSelection(`${request.targetId}\0${request.installId}`);
   const actions = usePlaylistActions(request, selection.clear);
   const status = rescan.isPending ? 'loading' : queryStatus(query);
   const snapshot = query.data ?? createEmptyPlaylistCollectionSnapshot(request);

   return (
      <>
         {active ? (
            <InstallPlaylistsPanel
               request={request}
               snapshot={snapshot}
               status={status}
               selection={selection}
               actions={actions}
               onRescan={() => rescan.mutate()}
            />
         ) : null}
         <PlaylistActionDialog request={request} actions={actions} />
      </>
   );
}

function InstallPlaylistsPanel({
   request,
   snapshot,
   status,
   selection,
   actions,
   onRescan
}: {
   request: TargetPlaylistCollectionRequest;
   snapshot: PlaylistCollectionSnapshot;
   status: QueryStatus;
   selection: CollectionSelection;
   actions: PlaylistActions;
   onRescan: () => void;
}) {
   const t = useTranslations('playlists');
   const problems = useTranslations('problems.playlists');
   const common = useTranslations('common');
   const format = useFormatters();
   const shared = useSharedFolder(request, 'playlists');
   const local = request.targetId === localTargetId;
   const [folderResult, setFolderResult] = useState<'failed' | 'unsupported' | null>(null);
   const [addOpen, setAddOpen] = useState(false);
   const [detailId, setDetailId] = useState<PlaylistId | null>(null);
   const [query, setQuery] = useState('');
   const { selected } = selection;
   const busy = status === 'loading' || snapshot.status === 'scanning' || actions.flow.busy;
   const filterText = query.trim().toLowerCase();
   const visible = useMemo(
      () => snapshot.playlists.filter((playlist) => matchesQuery(filterText, [playlist.title, playlist.author, playlist.fileName])),
      [snapshot.playlists, filterText]
   );
   const visibleIds = visible.map((playlist) => playlist.id);
   const selectedVisible = visibleIds.filter((playlistId) => selected.has(playlistId)).length;
   const scanning = snapshot.status === 'scanning' ? snapshot.progress : null;

   const openFolder = async () => {
      const opened = await Result.tryPromise(() => actions.openFolder());
      setFolderResult(Result.isError(opened) ? 'failed' : opened.value.status === 'opened' ? null : opened.value.status);
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
               disabled={busy}
               checked={selectionState(selectedVisible, visible.length)}
               onCheckedChange={() => selection.toggleAll(visibleIds)}
            />
         ),
         cell: ({ row }) => (
            <Checkbox
               aria-label={row.original.title}
               disabled={busy}
               checked={selected.has(row.original.id)}
               onClick={(event) => event.stopPropagation()}
               onCheckedChange={() => selection.toggle(row.original.id)}
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
         id: 'folder',
         size: 160,
         header: t('columns.folder'),
         accessorFn: (playlist) => playlist.fileName.split('/').slice(0, -1).join('/'),
         meta: { cellClassName: 'text-muted-foreground' }
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

   return (
      <CollectionPanel
         status={status}
         snapshotStatus={snapshot.status}
         total={snapshot.playlists.length}
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
         menu={local ? { label: common('openFolder.action'), icon: <FolderOpen />, onSelect: () => void openFolder() } : null}
         action={
            <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
               <Plus data-icon="inline-start" />
               {t('add.action')}
            </Button>
         }
         selection={{
            count: selected.size,
            exportLabel: t('export', { count: selected.size }),
            deleteLabel: t('deleteSelected', { count: selected.size }),
            onExport: local ? () => void actions.exportPlaylists([...selected]) : null,
            onDelete: () => void actions.previewDelete([...selected])
         }}
         notices={
            <>
               <SharedFolderNotice shared={shared} />
               {folderResult ? <p className="text-muted-foreground text-xs">{common(`openFolder.${folderResult}`)}</p> : null}
            </>
         }
         problems={snapshot.problems.map((problem) => ({ key: problem.code, message: problem.message }))}
         dialogs={
            <>
               {addOpen ? (
                  <PlaylistAddDialog
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
               ) : null}
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
            </>
         }
      >
         <DataTable
            columns={columns}
            data={visible}
            getRowId={(playlist) => playlist.id}
            label={t('title')}
            tableId="playlists"
            rowProps={(playlist) => ({ className: 'cursor-pointer', onClick: () => setDetailId(playlist.id) })}
         />
      </CollectionPanel>
   );
}
