import type { OperationProgress } from '@/modules/operations/contract';

const reportIntervalMs = 150;

export function throttleReports<Value>(report?: (value: Value) => void) {
   let lastReportAt = 0;

   return (value: Value, force = false) => {
      const now = Date.now();
      if (!report || (!force && now - lastReportAt < reportIntervalMs)) return;

      lastReportAt = now;
      report(value);
   };
}

export function percentOf(current: number, total: number) {
   return total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 100;
}

export function bytesProgress(phase: string, current: number, total: number, label?: string) {
   const progress: OperationProgress = {
      phase,
      current,
      total,
      percent: percentOf(current, total),
      unit: 'bytes'
   };
   if (label) progress.label = label;

   return progress;
}
