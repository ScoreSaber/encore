import { queryOptions } from '@tanstack/react-query';

import { isOperationTerminalStatus, type OperationSnapshot } from '@/modules/operations/contract';
import type { TargetId } from '@/modules/targets/contract';
import { unwrapTarget } from '@/renderer/ipc-result';
import { targetKey } from '@/renderer/query/api-query';

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

export function operationListQueryOptions(targetId: TargetId) {
   return queryOptions({
      queryKey: targetKey('operations', targetId, 'list'),
      queryFn: async () => retainOperationHistory(unwrapTarget(await window.encore.operations.list({ targetId })))
   });
}

export function upsertOperation(operations: OperationSnapshot[], snapshot: OperationSnapshot) {
   const known = operations.some((operation) => operation.id === snapshot.id);
   const updated = known ? operations.map((operation) => (operation.id === snapshot.id ? snapshot : operation)) : [...operations, snapshot];

   return retainOperationHistory(updated);
}
