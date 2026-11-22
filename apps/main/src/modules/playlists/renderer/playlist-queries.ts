import { queryOptions } from '@tanstack/react-query';

import type { TargetPlaylistCollectionRequest, TargetPlaylistDetailRequest } from '@/modules/playlists/api';
import { apiKey, installKey, snapshotGcTime, targetQuery } from '@/renderer/query/api-query';

export function playlistListQueryOptions(request: TargetPlaylistCollectionRequest) {
   return queryOptions({
      ...targetQuery(installKey('playlists', request, 'list'), () => window.encore.playlists.list(request)),
      gcTime: snapshotGcTime
   });
}

export function playlistDetailQueryOptions(request: TargetPlaylistDetailRequest) {
   return queryOptions({
      ...targetQuery(installKey('playlists', request, 'getDetail', request.playlistId), () => window.encore.playlists.getDetail(request)),
      gcTime: 0
   });
}

export const playlistLinkStateQueryOptions = queryOptions({
   queryKey: apiKey('playlists', 'getPlaylistLinkState'),
   queryFn: () => window.encore.playlists.getPlaylistLinkState()
});
