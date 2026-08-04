import { CheckCircle2 } from 'lucide-react';

import { PathText } from '@/components/text/path-text';

import { type Formatters, useFormatters } from '@/app/renderer/i18n/formatters';
import type { OperationProgress as OperationProgressSnapshot, OperationSnapshot } from '@/modules/operations/contract';

type OutcomeLabels = {
   progress: (values: { copied: string; total: string; label: string }) => string;
   completed: string;
   cancelled: string;
   failed: string;
};

export function OperationOutcome({ operation, labels }: { operation: OperationSnapshot; labels: OutcomeLabels }) {
   const format = useFormatters();

   if (operation.status === 'completed') {
      return (
         <p className="flex gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{labels.completed}</span>
         </p>
      );
   }

   if (operation.status === 'cancelled') return <p>{labels.cancelled}</p>;

   if (operation.status === 'failed') {
      return (
         <>
            <p>{labels.failed}</p>
            <p className="text-muted-foreground text-xs break-all">{operation.error?.message}</p>
         </>
      );
   }

   const progress = operation.progress;
   const percent = Math.min(Math.max(progress?.percent ?? 0, 0), 100);

   return (
      <OperationProgress
         percent={percent}
         label={labels.progress({
            copied: formatProgressValue(format, progress?.current ?? 0, progress?.unit),
            total: formatProgressValue(format, progress?.total ?? 0, progress?.unit),
            label: progress?.label ?? ''
         })}
      />
   );
}

function formatProgressValue(format: Formatters, value: number, unit: OperationProgressSnapshot['unit'] | undefined) {
   return unit === 'bytes' || unit === undefined ? format.bytes(value) : format.count(value);
}

export function OperationProgress({ percent, label }: { percent: number; label: string }) {
   return (
      <div className="flex flex-col gap-2">
         <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full transition-[width]" style={{ width: `${percent}%` }} />
         </div>
         <p className="text-muted-foreground text-xs">{label}</p>
      </div>
   );
}

export function PreviewRow({ label, value }: { label: string; value: string }) {
   return (
      <div className="min-w-0">
         <div className="font-medium">{label}</div>
         <div className="text-muted-foreground break-words">
            <PathText value={value} />
         </div>
      </div>
   );
}

export function PreviewList({ items }: { items: { id: string; label: string; detail?: string }[] }) {
   return (
      <ul className="divide-border max-h-56 overflow-y-auto rounded-md border">
         {items.map((item) => (
            <li key={item.id} className="flex min-w-0 items-baseline justify-between gap-3 px-3 py-2">
               <span className="min-w-0 break-words">{item.label}</span>
               {item.detail ? <span className="text-muted-foreground shrink-0 text-xs">{item.detail}</span> : null}
            </li>
         ))}
      </ul>
   );
}

export function isOperationFinished(operation: OperationSnapshot | null) {
   return operation !== null && operation.status !== 'queued' && operation.status !== 'running';
}
