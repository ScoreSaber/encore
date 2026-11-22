import { queryOptions, skipToken } from '@tanstack/react-query';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import { maxMapCoversPerRequest, type LocalMapSummary, type MapId } from '@/modules/maps/contract';
import { abortable, apiKey, installKey, snapshotGcTime, targetQuery } from '@/renderer/query/api-query';

export function mapListQueryOptions(request: TargetMapCollectionRequest) {
   return queryOptions({
      ...targetQuery(installKey('maps', request, 'list'), () => window.encore.maps.list(request)),
      gcTime: snapshotGcTime
   });
}

export function mapCoverQueryOptions(request: TargetMapCollectionRequest, map: LocalMapSummary) {
   return queryOptions({
      queryKey: installKey('maps', request, 'getCovers', map.id, map.updatedAt),
      queryFn: ({ signal }) => abortable(signal, () => loadMapCover(request, map.id, signal)),
      staleTime: Infinity
   });
}

export function mapMetadataQueryOptions(hash: string | null) {
   return queryOptions({
      queryKey: apiKey('maps', 'getMetadata', hash),
      queryFn: hash ? ({ signal }) => abortable(signal, () => window.encore.maps.getMetadata({ hash })) : skipToken,
      staleTime: 5 * 60_000
   });
}

const maxDeferredCoverRetries = 5;

type PendingCover = {
   mapId: MapId;
   signal: AbortSignal;
   retries: number;
   resolve: (cover: string | null) => void;
   reject: () => void;
};

const pendingCovers = new Map<string, { request: TargetMapCollectionRequest; covers: PendingCover[] }>();
let coverFlushQueued = false;

function loadMapCover(request: TargetMapCollectionRequest, mapId: MapId, signal: AbortSignal) {
   if (signal.aborted) return Promise.resolve<string | null>(null);

   return new Promise<string | null>((resolve, reject) => {
      const entry: PendingCover = {
         mapId,
         signal,
         retries: 0,
         resolve,
         reject: () => reject(new Error('map cover request failed'))
      };
      const onAbort = () => {
         const key = `${request.targetId}\0${request.installId}`;
         const batch = pendingCovers.get(key);
         if (batch) {
            const index = batch.covers.indexOf(entry);
            if (index >= 0) batch.covers.splice(index, 1);
            if (batch.covers.length === 0) pendingCovers.delete(key);
         }
         resolve(null);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      const originalResolve = entry.resolve;
      const originalReject = entry.reject;
      entry.resolve = (cover) => {
         signal.removeEventListener('abort', onAbort);
         originalResolve(cover);
      };
      entry.reject = () => {
         signal.removeEventListener('abort', onAbort);
         originalReject();
      };
      queueMapCover(request, entry);
   });
}

function queueMapCover(request: TargetMapCollectionRequest, cover: PendingCover) {
   if (cover.signal.aborted) return;

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
      const active = batch.covers.filter((cover) => !cover.signal.aborted);
      for (let offset = 0; offset < active.length; offset += maxMapCoversPerRequest) {
         const covers = active.slice(offset, offset + maxMapCoversPerRequest);
         const uniqueIds = [...new Set(covers.map((cover) => cover.mapId))];
         void window.encore.maps.getCovers({ ...batch.request, mapIds: uniqueIds }).then(
            (response) => {
               if (response.status !== 'ok') {
                  for (const cover of covers) {
                     if (!cover.signal.aborted) cover.reject();
                  }
                  return;
               }

               const received = new Map(response.value.covers.map((cover) => [cover.mapId, cover.dataUrl]));
               const deferred = new Set(response.value.deferredMapIds);
               for (const cover of covers) {
                  if (cover.signal.aborted) continue;

                  const dataUrl = received.get(cover.mapId);
                  if (dataUrl !== undefined) cover.resolve(dataUrl);
                  else if (deferred.has(cover.mapId) && cover.retries < maxDeferredCoverRetries) {
                     cover.retries += 1;
                     queueMapCover(batch.request, cover);
                  } else cover.resolve(null);
               }
            },
            () => {
               for (const cover of covers) {
                  if (!cover.signal.aborted) cover.reject();
               }
            }
         );
      }
   }
}

export const mapLinkStateQueryOptions = queryOptions({
   queryKey: apiKey('maps', 'getMapLinkState'),
   queryFn: () => window.encore.maps.getMapLinkState()
});
