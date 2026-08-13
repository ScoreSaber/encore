import { useEffect } from 'react';

import { queryOptions, skipToken, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { mapsApi, type TargetMapCollectionRequest } from '@/modules/maps/api';
import {
   createEmptyMapCollectionSnapshot,
   maxMapCoversPerRequest,
   type LocalMapSummary,
   type MapId,
   type MapSearchResult
} from '@/modules/maps/contract';
import { mapsIpc } from '@/modules/maps/ipc';
import { abortable, ipcQueryKey, setExistingQueryData, snapshotQueryGcTime } from '@/renderer/query/utils';

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

            const result: MapSearchResult = {
               status: 'failed',
               issue: response.status === 'unsupported' ? 'unsupported' : 'fetch-failed'
            };
            if (response.status === 'unavailable') result.detail = response.error.message;
            return result;
         }),
      gcTime: 0
   });
}

export function mapCoverQueryOptions(request: TargetMapCollectionRequest, map: LocalMapSummary) {
   return queryOptions({
      queryKey: ipcQueryKey(mapsTargetIpc.getCovers, request.targetId, request.installId, map.id, map.updatedAt),
      queryFn: ({ signal }) => abortable(signal, () => loadMapCover(request, map.id)),
      staleTime: Infinity
   });
}

export function mapMetadataQueryOptions(hash: string | null) {
   return queryOptions({
      queryKey: ipcQueryKey(mapsIpc.getMetadata, hash),
      queryFn: hash ? ({ signal }) => abortable(signal, () => window.encore.maps.getMetadata({ hash })) : skipToken,
      staleTime: 5 * 60_000
   });
}

type PendingCover = {
   mapId: MapId;
   resolve: (cover: string | null) => void;
   reject: () => void;
};

const pendingCovers = new Map<string, { request: TargetMapCollectionRequest; covers: PendingCover[] }>();
let coverFlushQueued = false;

function loadMapCover(request: TargetMapCollectionRequest, mapId: MapId) {
   return new Promise<string | null>((resolve, reject) => {
      queueMapCover(request, { mapId, resolve, reject: () => reject(new Error('map cover request failed')) });
   });
}

function queueMapCover(request: TargetMapCollectionRequest, cover: PendingCover) {
   const key = `${request.targetId}\0${request.installId}`;
   const batch = pendingCovers.get(key) ?? { request, covers: [] };
   batch.covers.push(cover);
   pendingCovers.set(key, batch);

   if (coverFlushQueued) return;
   coverFlushQueued = true;
   queueMicrotask(flushMapCovers);
}

function flushMapCovers() {
   coverFlushQueued = false;
   const batches = [...pendingCovers.values()];
   pendingCovers.clear();

   for (const batch of batches) {
      for (let offset = 0; offset < batch.covers.length; offset += maxMapCoversPerRequest) {
         const covers = batch.covers.slice(offset, offset + maxMapCoversPerRequest);
         void window.encore.maps.getCovers({ ...batch.request, mapIds: covers.map((cover) => cover.mapId) }).then(
            (response) => {
               if (response.status !== 'ok') {
                  for (const cover of covers) cover.reject();
                  return;
               }

               const received = new Map(response.value.covers.map((cover) => [cover.mapId, cover.dataUrl]));
               const deferred = new Set(response.value.deferredMapIds);
               for (const cover of covers) {
                  const dataUrl = received.get(cover.mapId);
                  if (dataUrl !== undefined) cover.resolve(dataUrl);
                  else if (deferred.has(cover.mapId)) queueMapCover(batch.request, cover);
                  else cover.resolve(null);
               }
            },
            () => {
               for (const cover of covers) cover.reject();
            }
         );
      }
   }
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
