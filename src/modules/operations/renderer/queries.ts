import { useEffect } from 'react';

import { queryOptions, useQueryClient } from '@tanstack/react-query';

import { createTargetIpcDescriptor } from '@/app/ipc/target-api';
import { ipcQueryKey, setExistingQueryData } from '@/app/renderer/query/utils';
import { operationsApi } from '@/modules/operations/api';
import { isOperationTerminalStatus, type OperationSnapshot } from '@/modules/operations/contract';

const operationsIpc = createTargetIpcDescriptor(operationsApi);

const maxTerminalOperations = 100;

function retainOperationHistory(operations: OperationSnapshot[]) {
   let terminalSlots = maxTerminalOperations;
   const retained: OperationSnapshot[] = [];

   for (let index = operations.length - 1; index >= 0; index -= 1) {
      const operation = operations[index];
      if (!operation) continue;

      if (isOperationTerminalStatus(operation.status)) {
         if (terminalSlots === 0) continue;
         terminalSlots -= 1;
      }

      retained.push(operation);
   }

   retained.reverse();
   return retained;
}

export function operationListQueryOptions(targetId: string) {
   return queryOptions({
      queryKey: ipcQueryKey(operationsIpc.list, targetId),
      queryFn: async () => {
         const response = await window.encore.operations.list({ targetId });
         return retainOperationHistory(response.status === 'ok' ? response.value : []);
      }
   });
}

export function useOperationEventSync() {
   const queryClient = useQueryClient();

   useEffect(() => {
      return window.encore.operations.onSnapshot((event) => {
         const queryKey = operationListQueryOptions(event.targetId).queryKey;
         setExistingQueryData<OperationSnapshot[]>(queryClient, queryKey, (current) => {
            const operations = current ?? [];
            const known = operations.some((operation) => operation.id === event.snapshot.id);
            const updated = known
               ? operations.map((operation) => (operation.id === event.snapshot.id ? event.snapshot : operation))
               : [...operations, event.snapshot];

            return retainOperationHistory(updated);
         });
      });
   }, [queryClient]);
}
