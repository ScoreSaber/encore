import { useCallback, useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { OperationId, OperationSnapshot } from '@/modules/operations/contract';
import { operationListQueryOptions } from '@/modules/operations/renderer/queries';
import type { TargetId } from '@/modules/targets/contract';

export const missingOperationGraceMs = 1_500;

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

export function useTrackedOperation(operations: readonly OperationSnapshot[], operationId: OperationId | null, startedAt: number) {
   const operation = operationId ? (operations.find((candidate) => candidate.id === operationId) ?? null) : null;
   const [tracking, setTracking] = useState<{ operationId: OperationId | null; seen: boolean; missing: boolean }>({
      operationId: null,
      seen: false,
      missing: false
   });
   const seen = operationId !== null && (operation !== null || (tracking.operationId === operationId && tracking.seen));
   const missing = operationId !== null && operation === null && (seen || (tracking.operationId === operationId && tracking.missing));

   useEffect(() => {
      if (!operationId) return;

      if (operation) {
         if (tracking.operationId !== operationId || !tracking.seen || tracking.missing) {
            setTracking({ operationId, seen: true, missing: false });
         }
         return;
      }

      if (missing) return;

      const delay = Math.max(0, startedAt + missingOperationGraceMs - Date.now());
      const timer = setTimeout(() => {
         setTracking({ operationId, seen: false, missing: true });
      }, delay);
      return () => clearTimeout(timer);
   }, [missing, operation, operationId, startedAt, tracking.missing, tracking.operationId, tracking.seen]);

   return { operation, missing };
}
