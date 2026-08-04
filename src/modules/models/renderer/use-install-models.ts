import { useCallback, useEffect, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useSnapshotMutation } from '@/app/renderer/query/use-snapshot-mutation';
import type { TargetModelCollectionRequest } from '@/modules/models/api';
import { createEmptyModelCollectionSnapshot, type ModelId, type ModelType } from '@/modules/models/contract';
import { modelListQueryOptions } from '@/modules/models/renderer/model-queries';

export type InstallModels = ReturnType<typeof useInstallModels>;

export function useInstallModels(request: TargetModelCollectionRequest) {
   const { targetId, installId } = request;
   const query = useQuery(modelListQueryOptions(request));
   const rescanModels = useSnapshotMutation({
      queryKey: modelListQueryOptions(request).queryKey,
      run: async () => {
         const response = await window.encore.models.rescan(request);
         return response.status === 'ok' ? response.value : createEmptyModelCollectionSnapshot(request, 'unsupported');
      }
   });
   const [selected, setSelected] = useState<Set<ModelId>>(() => new Set());
   const [type, setType] = useState<ModelType>('saber');

   useEffect(() => setSelected(new Set()), [targetId, installId]);

   const snapshot = query.data ?? createEmptyModelCollectionSnapshot(request);
   const models = useMemo(() => snapshot.models.filter((model) => model.type === type), [snapshot.models, type]);
   const counts = useMemo(() => {
      const tally: Record<ModelType, number> = {
         avatar: 0,
         bloq: 0,
         platform: 0,
         saber: 0,
         wall: 0
      };
      for (const model of snapshot.models) {
         tally[model.type] += 1;
      }

      return tally;
   }, [snapshot.models]);

   const selectType = useCallback((next: ModelType) => {
      setType(next);
      setSelected(new Set());
   }, []);

   const toggle = useCallback((modelId: ModelId) => {
      setSelected((current) => {
         const next = new Set(current);
         if (!next.delete(modelId)) next.add(modelId);

         return next;
      });
   }, []);

   const toggleAll = useCallback((modelIds: ModelId[]) => {
      setSelected((current) => (modelIds.some((modelId) => current.has(modelId)) ? new Set() : new Set(modelIds)));
   }, []);

   const clearSelection = useCallback(() => setSelected(new Set()), []);

   const status = query.isError ? 'error' : query.isPending || rescanModels.isPending ? 'loading' : 'ready';

   return {
      snapshot,
      models,
      counts,
      type,
      status,
      selected,
      rescan: () => rescanModels.mutate(),
      selectType,
      toggle,
      toggleAll,
      clearSelection
   };
}
