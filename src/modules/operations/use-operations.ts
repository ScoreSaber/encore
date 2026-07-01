import { useCallback, useEffect, useState } from 'react';

import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { OperationCancelResult, OperationDemoStartRequest, OperationDemoStartResult, OperationSnapshot } from '@/shared/operations';

export function useOperations() {
   const [operations, setOperations] = useState<OperationSnapshot[]>([]);

   useEffect(() => {
      const api = getEncoreApi();
      let disposed = false;

      void api.operations.list().then((snapshotList) => {
         if (!disposed) setOperations(snapshotList);
      });

      const unsubscribe = api.operations.onSnapshot((event) => {
         if (disposed) return;

         setOperations((currentOperations) => mergeOperationSnapshot(currentOperations, event.snapshot));
      });

      return () => {
         disposed = true;
         unsubscribe();
      };
   }, []);

   const cancelOperation = useCallback((id: OperationSnapshot['id']): Promise<OperationCancelResult> => {
      return getEncoreApi().operations.cancel(id);
   }, []);

   const startDemoOperation = useCallback((request: OperationDemoStartRequest = {}): Promise<OperationDemoStartResult> => {
      return getEncoreApi().operations.startDemo(request);
   }, []);

   return {
      operations,
      cancelOperation,
      startDemoOperation
   };
}

function mergeOperationSnapshot(operations: OperationSnapshot[], snapshot: OperationSnapshot) {
   const nextOperations = [...operations];
   const existingIndex = nextOperations.findIndex((operation) => operation.id === snapshot.id);

   if (existingIndex === -1) {
      nextOperations.push(snapshot);
      return nextOperations;
   }

   nextOperations[existingIndex] = snapshot;
   return nextOperations;
}
