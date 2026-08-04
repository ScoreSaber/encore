import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/app/ipc/target-api';
import { abortable, ipcQueryKey, setExistingQueryData, snapshotQueryGcTime } from '@/app/renderer/query/utils';
import { mapsApi, type TargetMapCollectionRequest } from '@/modules/maps/api';
import { createEmptyMapCollectionSnapshot, type MapSearchResult } from '@/modules/maps/contract';
import { mapsIpc } from '@/modules/maps/ipc';

const mapsTargetIpc = createTargetIpcDescriptor(mapsApi);

export function mapListQueryOptions(request: TargetMapCollectionRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(mapsTargetIpc.list, request.targetId, request.installId),
      queryFn: ({ signal }) =>
         abortable(signal, async () => {
            const response = await window.encore.maps.list(request);
            return response.status === 'ok' ? response.value : createEmptyMapCollectionSnapshot(request, 'unsupported');
         }),
      gcTime: snapshotQueryGcTime
   });
}

export function mapSearchQueryOptions(request: TargetMapCollectionRequest, query: string, page: number) {
   return queryOptions({
      queryKey: ipcQueryKey(mapsTargetIpc.search, request.targetId, request.installId, query, page),
      queryFn: ({ signal }) =>
         abortable(signal, async (): Promise<MapSearchResult> => {
            const response = await window.encore.maps.search({
               ...request,
               query,
               page
            });
            if (response.status === 'ok') return response.value;

            return {
               status: 'failed',
               issue: response.status === 'unsupported' ? 'unsupported' : 'fetch-failed',
               ...(response.status === 'unavailable' ? { detail: response.error.message } : {})
            };
         }),
      gcTime: 0
   });
}

export const mapLinkStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(mapsIpc.getMapLinkState),
   queryFn: () => window.encore.maps.getMapLinkState()
});

export function useMapEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.maps.onSnapshot(({ targetId, snapshot }) => {
         setExistingQueryData(queryClient, mapListQueryOptions({ targetId, installId: snapshot.installId }).queryKey, snapshot);
      });
   }, [queryClient]);
}
