import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { playlistsApi, type TargetPlaylistCollectionRequest, type TargetPlaylistDetailRequest } from '@/modules/playlists/api';
import { playlistsIpc } from '@/modules/playlists/ipc';
import { abortable, ipcQueryKey, setExistingQueryData, snapshotQueryGcTime } from '@/renderer/query/utils';

const playlistsTargetIpc = createTargetIpcDescriptor(playlistsApi);

export function playlistListQueryOptions(request: TargetPlaylistCollectionRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(playlistsTargetIpc.list, request.targetId, request.installId),
      queryFn: ({ signal }) => abortable(signal, () => window.encore.playlists.list(request)),
      gcTime: snapshotQueryGcTime
   });
}

export function playlistDetailQueryOptions(request: TargetPlaylistDetailRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(playlistsTargetIpc.getDetail, request.targetId, request.installId, request.playlistId),
      queryFn: () => window.encore.playlists.getDetail(request),
      gcTime: 0
   });
}

export const playlistLinkStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(playlistsIpc.getPlaylistLinkState),
   queryFn: () => window.encore.playlists.getPlaylistLinkState()
});

export function usePlaylistEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.playlists.onSnapshot(({ targetId, snapshot }) => {
         setExistingQueryData(queryClient, playlistListQueryOptions({ targetId, installId: snapshot.installId }).queryKey, {
            targetId,
            status: 'ok',
            value: snapshot
         });
         void queryClient.invalidateQueries({ queryKey: ipcQueryKey(playlistsTargetIpc.getDetail, targetId, snapshot.installId) });
      });
   }, [queryClient]);
}
