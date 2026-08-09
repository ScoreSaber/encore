import type { OperationProgress } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

const progressThrottleMs = 200;

export function createThrottledProgress(onProgress?: (progress: OperationProgress) => void) {
   let lastReportAt = 0;

   return (progress: OperationProgress, options: { force?: boolean } = {}) => {
      if (!onProgress) return;

      const now = Date.now();
      if (!options.force && now - lastReportAt < progressThrottleMs) return;
      lastReportAt = now;
      onProgress(progress);
   };
}

export function createInstallProgress(operations: OperationRegistry) {
   return (operationId: string, index: number, total: number, progress: OperationProgress) => {
      const done = index + Math.min(1, (progress.percent ?? 0) / 100);

      operations.update(operationId, {
         progress: {
            phase: progress.phase ?? 'installing',
            current: done,
            total,
            percent: Math.min(100, Math.round((done / total) * 100)),
            unit: 'items',
            ...(progress.label ? { label: progress.label } : {})
         }
      });
   };
}

export function createBytesProgress(operations: OperationRegistry) {
   return (operationId: string, phase: string, current: number, total: number, label: string) => {
      operations.update(operationId, {
         progress: {
            phase,
            current,
            total,
            percent: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 100,
            unit: 'bytes',
            label
         }
      });
   };
}
