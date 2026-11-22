import { bytesProgress } from '@/lib/progress';
import type { OperationProgress } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';

export function createInstallProgress(operations: OperationRegistry) {
   return (operationId: string, index: number, total: number, progress: OperationProgress) => {
      const done = index + Math.min(1, (progress.percent ?? 0) / 100);
      const nextProgress: OperationProgress = {
         phase: progress.phase ?? 'installing',
         current: done,
         total,
         percent: Math.min(100, Math.round((done / total) * 100)),
         unit: 'items'
      };
      if (progress.label) nextProgress.label = progress.label;

      operations.update(operationId, {
         progress: nextProgress
      });
   };
}

export function createBytesProgress(operations: OperationRegistry) {
   return (operationId: string, phase: string, current: number, total: number, label: string) => {
      operations.update(operationId, { progress: bytesProgress(phase, current, total, label) });
   };
}
