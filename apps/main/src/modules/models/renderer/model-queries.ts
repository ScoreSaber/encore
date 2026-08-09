import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/ipc/target-api';
import { modelsApi, type TargetModelCollectionRequest } from '@/modules/models/api';
import { createEmptyModelCollectionSnapshot, type ModelSearchResult, type ModelType } from '@/modules/models/contract';
import { modelsIpc } from '@/modules/models/ipc';
import { abortable, ipcQueryKey, setExistingQueryData, snapshotQueryGcTime } from '@/renderer/query/utils';

const modelsTargetIpc = createTargetIpcDescriptor(modelsApi);

export function modelListQueryOptions(request: TargetModelCollectionRequest) {
   return queryOptions({
      queryKey: ipcQueryKey(modelsTargetIpc.list, request.targetId, request.installId),
      queryFn: ({ signal }) =>
         abortable(signal, async () => {
            const response = await window.encore.models.list(request);
            return response.status === 'ok' ? response.value : createEmptyModelCollectionSnapshot(request, 'unsupported');
         }),
      gcTime: snapshotQueryGcTime
   });
}

export function modelSearchQueryOptions(request: TargetModelCollectionRequest, type: ModelType, query: string, page: number) {
   return queryOptions({
      queryKey: ipcQueryKey(modelsTargetIpc.search, request.targetId, request.installId, type, query, page),
      queryFn: ({ signal }) =>
         abortable(signal, async (): Promise<ModelSearchResult> => {
            const response = await window.encore.models.search({
               ...request,
               type,
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

export const modelLinkStateQueryOptions = queryOptions({
   queryKey: ipcQueryKey(modelsIpc.getModelLinkState),
   queryFn: () => window.encore.models.getModelLinkState()
});

export function useModelEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.models.onSnapshot(({ targetId, snapshot }) => {
         setExistingQueryData(queryClient, modelListQueryOptions({ targetId, installId: snapshot.installId }).queryKey, snapshot);
      });
   }, [queryClient]);
}
