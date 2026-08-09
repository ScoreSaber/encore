import { useCallback, useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { TargetMapCollectionRequest } from '@/modules/maps/api';
import { createEmptyMapCollectionSnapshot, type MapId } from '@/modules/maps/contract';
import { mapListQueryOptions } from '@/modules/maps/renderer/map-queries';
import { useSnapshotMutation } from '@/renderer/query/use-snapshot-mutation';

export type InstallMaps = ReturnType<typeof useInstallMaps>;

export function useInstallMaps(request: TargetMapCollectionRequest) {
   const { targetId, installId } = request;
   const query = useQuery(mapListQueryOptions(request));
   const rescanMaps = useSnapshotMutation({
      queryKey: mapListQueryOptions(request).queryKey,
      run: async () => {
         const response = await window.encore.maps.rescan(request);
         return response.status === 'ok' ? response.value : createEmptyMapCollectionSnapshot(request, 'unsupported');
      }
   });
   const [selected, setSelected] = useState<Set<MapId>>(() => new Set());

   useEffect(() => setSelected(new Set()), [targetId, installId]);

   const toggle = useCallback((mapId: MapId) => {
      setSelected((current) => {
         const next = new Set(current);
         if (!next.delete(mapId)) next.add(mapId);

         return next;
      });
   }, []);

   const toggleAll = useCallback((mapIds: MapId[]) => {
      setSelected((current) => (mapIds.some((mapId) => current.has(mapId)) ? new Set() : new Set(mapIds)));
   }, []);

   const clearSelection = useCallback(() => setSelected(new Set()), []);

   const snapshot = query.data ?? createEmptyMapCollectionSnapshot(request);
   const status = query.isError ? 'error' : query.isPending || rescanMaps.isPending ? 'loading' : 'ready';

   return {
      snapshot,
      status,
      selected,
      rescan: () => rescanMaps.mutate(),
      toggle,
      toggleAll,
      clearSelection
   };
}
