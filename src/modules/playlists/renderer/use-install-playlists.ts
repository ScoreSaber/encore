import { useCallback, useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import type { TargetPlaylistCollectionRequest } from '@/modules/playlists/api';
import { createEmptyPlaylistCollectionSnapshot, type PlaylistId } from '@/modules/playlists/contract';
import { playlistListQueryOptions } from '@/modules/playlists/renderer/playlist-queries';

export type InstallPlaylists = ReturnType<typeof useInstallPlaylists>;

export function useInstallPlaylists(request: TargetPlaylistCollectionRequest) {
   const { targetId, installId } = request;
   const query = useQuery(playlistListQueryOptions(request));
   const rescanPlaylists = useSnapshotMutation({
      queryKey: playlistListQueryOptions(request).queryKey,
      run: () => window.encore.playlists.rescan(request)
   });
   const [selected, setSelected] = useState<Set<PlaylistId>>(() => new Set());

   useEffect(() => setSelected(new Set()), [targetId, installId]);

   const toggle = useCallback((playlistId: PlaylistId) => {
      setSelected((current) => {
         const next = new Set(current);
         if (!next.delete(playlistId)) next.add(playlistId);

         return next;
      });
   }, []);

   const toggleAll = useCallback((playlistIds: PlaylistId[]) => {
      setSelected((current) => (playlistIds.some((playlistId) => current.has(playlistId)) ? new Set() : new Set(playlistIds)));
   }, []);

   const clearSelection = useCallback(() => setSelected(new Set()), []);

   const snapshot = query.data?.status === 'ok' ? query.data.value : createEmptyPlaylistCollectionSnapshot(request);
   const status = query.isError ? 'error' : query.isPending || rescanPlaylists.isPending ? 'loading' : 'ready';

   return {
      snapshot,
      status,
      selected,
      rescan: () => rescanPlaylists.mutate(),
      toggle,
      toggleAll,
      clearSelection
   };
}
