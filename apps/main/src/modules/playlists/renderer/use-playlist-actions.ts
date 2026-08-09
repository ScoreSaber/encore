import { useCallback } from 'react';

import { useContentActions } from '@/components/content/use-content-actions';

import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import type { PlaylistActionProblem, PlaylistId, ReadyPlaylistDeletePreview } from '@/modules/playlists/contract';

type PlaylistActionKind = 'delete' | 'download' | 'export' | 'import' | 'installMissing';

export type PlaylistActions = ReturnType<typeof usePlaylistActions>;

export function usePlaylistActions(request: TargetPlaylistCollectionRequest, onFinished?: () => void) {
   const playlists = window.encore.playlists;
   const { state, setState, operation, start, startTarget, confirmTargetDelete, cancel, dismiss } = useContentActions<
      Exclude<PlaylistActionKind, 'delete'>,
      PlaylistActionProblem,
      ReadyPlaylistDeletePreview,
      PlaylistId[]
   >(
      request.targetId,
      { code: 'playlists.start-failed', message: 'the playlist operation could not be started' },
      { code: 'playlists.start-failed', message: 'the delete could not be started' },
      onFinished
   );

   const previewDelete = useCallback(
      async (playlistIds: PlaylistId[], deleteMaps = false) => {
         setState({ status: 'previewing', kind: 'delete' });

         const response = await playlists.previewDelete({ ...request, playlistIds, deleteMaps }).catch(() => null);
         if (!response || response.status !== 'ok') {
            setState({
               status: 'failed',
               kind: 'delete',
               error: { code: 'playlists.preview-failed', message: 'the selected playlists could not be read' }
            });
            return;
         }

         const previewed = response.value;
         setState(
            previewed.status === 'ok'
               ? { status: 'ready', kind: 'delete', preview: previewed, selection: playlistIds }
               : { status: 'invalid', kind: 'delete', problem: previewed }
         );
      },
      [playlists, request, setState]
   );

   const confirm = useCallback(
      () => confirmTargetDelete((playlistIds, preview) => playlists.startDelete({ ...request, playlistIds, deleteMaps: preview.deleteMaps })),
      [confirmTargetDelete, playlists, request]
   );

   const importPlaylists = useCallback(async () => {
      const chosen = await playlists.choosePlaylistImport(request).catch(() => null);
      if (!chosen || chosen.status === 'cancelled') return;

      if (chosen.status === 'unsupported') {
         setState({
            status: 'failed',
            kind: 'import',
            error: { code: 'playlists.import-unsupported', message: 'this target cannot import playlists' }
         });
         return;
      }

      await start('import', () => playlists.importPlaylists({ ...request, paths: chosen.paths }));
   }, [playlists, request, setState, start]);

   const exportPlaylists = useCallback(
      async (playlistIds: PlaylistId[]) => {
         const chosen = await playlists.choosePlaylistExport({ ...request, playlistIds }).catch(() => null);
         if (!chosen || chosen.status === 'cancelled') return;

         if (chosen.status === 'unsupported') {
            setState({
               status: 'failed',
               kind: 'export',
               error: { code: 'playlists.export-unsupported', message: 'this target cannot export playlists' }
            });
            return;
         }

         await start('export', () => playlists.exportPlaylists({ ...request, playlistIds, destinationPath: chosen.path }));
      },
      [playlists, request, setState, start]
   );

   const downloadPlaylist = useCallback(
      (url: string) => startTarget('download', () => playlists.startDownload({ ...request, url })),
      [playlists, request, startTarget]
   );

   const installMissingMaps = useCallback(
      (playlistId: PlaylistId) => startTarget('installMissing', () => playlists.startInstallMissing({ ...request, playlistId })),
      [playlists, request, startTarget]
   );

   const openFolder = useCallback(() => playlists.openPlaylistFolder(request), [playlists, request]);

   return {
      state,
      operation,
      previewDelete,
      confirm,
      importPlaylists,
      exportPlaylists,
      downloadPlaylist,
      installMissingMaps,
      cancel,
      dismiss,
      openFolder
   };
}
