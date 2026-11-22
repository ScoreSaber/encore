import { useCallback } from 'react';

import { useCollectionActions, type CollectionActionPreset, type CollectionActionReady } from '@/components/collection/use-collection-actions';

import { createProblem } from '@/lib/errors';
import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import type { PlaylistActionProblem, PlaylistId, ReadyPlaylistDeletePreview } from '@/modules/playlists/contract';

type PlaylistActionReady = CollectionActionReady<ReadyPlaylistDeletePreview, PlaylistId, 'installMissing'>;

const startFailure = createProblem('playlists.start-failed');

const playlistActionsPreset: CollectionActionPreset<TargetPlaylistCollectionRequest, PlaylistId, ReadyPlaylistDeletePreview, string> = {
   failures: {
      start: startFailure,
      preview: createProblem('playlists.preview-failed'),
      importUnsupported: createProblem('playlists.import-unsupported'),
      exportUnsupported: createProblem('playlists.export-unsupported')
   },
   chooseImport: (request) => window.encore.playlists.choosePlaylistImport(request),
   startImport: (request, paths) => window.encore.playlists.importPlaylists({ ...request, paths }),
   chooseExport: (request, playlistIds) => window.encore.playlists.choosePlaylistExport({ ...request, playlistIds }),
   startExport: (request, playlistIds, destinationPath) => window.encore.playlists.exportPlaylists({ ...request, playlistIds, destinationPath }),
   startDownload: (request, url) => window.encore.playlists.startDownload({ ...request, url }),
   startDelete: (request, playlistIds, preview) => window.encore.playlists.startDelete({ ...request, playlistIds, deleteMaps: preview.deleteMaps })
};

export type PlaylistActions = ReturnType<typeof usePlaylistActions>;

export function usePlaylistActions(request: TargetPlaylistCollectionRequest, onFinished: () => void) {
   const {
      flow,
      previewDelete: runPreviewDelete,
      confirm,
      importItems: importPlaylists,
      exportItems: exportPlaylists,
      download: downloadPlaylist
   } = useCollectionActions<TargetPlaylistCollectionRequest, PlaylistId, ReadyPlaylistDeletePreview, PlaylistActionProblem, string, 'installMissing'>(
      request,
      playlistActionsPreset,
      onFinished
   );
   const { start, state } = flow;

   const previewDelete = useCallback(
      (playlistIds: PlaylistId[], deleteMaps = false, pending?: PlaylistActionReady) =>
         runPreviewDelete(playlistIds, () => window.encore.playlists.previewDelete({ ...request, playlistIds, deleteMaps }), pending),
      [request, runPreviewDelete]
   );

   const installMissingMaps = useCallback(
      (playlistId: PlaylistId) =>
         start(
            { kind: 'installMissing', preview: null },
            () => window.encore.playlists.startInstallMissing({ ...request, playlistId }),
            startFailure
         ),
      [request, start]
   );

   const setDeleteMaps = useCallback(
      (deleteMaps: boolean) => {
         if ((state.status === 'ready' || state.status === 'repreviewing') && state.kind === 'delete') {
            void previewDelete(state.selection, deleteMaps, {
               kind: 'delete',
               preview: { ...state.preview, deleteMaps },
               selection: state.selection
            });
         }
      },
      [previewDelete, state]
   );

   const openFolder = useCallback(() => window.encore.playlists.openPlaylistFolder(request), [request]);

   return { flow, previewDelete, setDeleteMaps, confirm, importPlaylists, exportPlaylists, downloadPlaylist, installMissingMaps, openFolder };
}
