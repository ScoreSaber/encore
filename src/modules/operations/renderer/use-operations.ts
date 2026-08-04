import { useCallback } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { OperationSnapshot } from '@/modules/operations/contract';
import { operationListQueryOptions } from '@/modules/operations/renderer/queries';
import type { TargetId } from '@/modules/targets/contract';

export function useOperations(targetId: TargetId) {
   const query = useQuery(operationListQueryOptions(targetId));

   const cancelOperation = useCallback(
      (id: OperationSnapshot['id']) => {
         return window.encore.operations.cancel({ targetId, id });
      },
      [targetId]
   );

   return {
      operations: query.data ?? [],
      cancelOperation
   };
}
