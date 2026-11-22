import type { ReactNode } from 'react';

import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { OperationOutcome, OperationProgress } from '@/modules/operations/renderer/operation-progress';
import type { OperationFlow } from '@/modules/operations/renderer/use-operation-flow';

type ProgressValues = { copied: string; total: string; label: string };

export function OperationFlowDialog<Ready extends { kind: string }, Problem extends { detail?: string }>({
   flow,
   title,
   description,
   className,
   hidden = false,
   issue,
   preview,
   labels,
   confirm
}: {
   flow: OperationFlow<Ready, Problem>;
   title: string;
   description: string | null;
   className?: string;
   hidden?: boolean;
   issue: (problem: Problem) => string;
   preview: (ready: Ready, editable: boolean) => ReactNode;
   labels: {
      failed: string;
      completed: string;
      cancelled: string;
      preparing?: string;
      progress?: (values: ProgressValues) => string;
   };
   confirm: {
      label: string;
      run: (ready: Ready) => void;
      variant?: 'default' | 'destructive';
      disabled?: boolean;
      icon?: ReactNode;
   };
}) {
   const common = useTranslations('common');
   const { state, operation, missing, finished, cancelable, busy } = flow;
   const open = state.status !== 'idle' && state.status !== 'choosing' && !hidden;

   return (
      <Dialog
         open={open}
         onOpenChange={(nextOpen) => {
            if (nextOpen || hidden || busy) return;

            flow.dismiss();
         }}
      >
         <DialogContent className={className}>
            <DialogHeader>
               <DialogTitle>{title}</DialogTitle>
               {description ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{issue(state.problem)}</p>
                     {state.problem.detail ? <p className="text-muted-foreground text-xs break-all">{state.problem.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{labels.failed}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' ||
               state.status === 'repreviewing' ||
               state.status === 'starting' ||
               state.status === 'submitting' ||
               state.status === 'running'
                  ? preview(state, state.status === 'ready' || state.status === 'repreviewing')
                  : null}

               {state.status === 'starting' || state.status === 'submitting' || (state.status === 'running' && !operation && !missing) ? (
                  <OperationProgress percent={0} label={labels.preparing ?? common('operation.preparing')} />
               ) : null}

               {missing ? <p className="text-muted-foreground">{common('operation.missing')}</p> : null}

               {operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: labels.progress ?? ((values) => common('operation.progress', values)),
                        completed: labels.completed,
                        cancelled: labels.cancelled,
                        failed: labels.failed
                     }}
                  />
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' || state.status === 'repreviewing' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={flow.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button
                        type="button"
                        size="sm"
                        variant={confirm.variant}
                        disabled={confirm.disabled || state.status === 'repreviewing'}
                        onClick={() => {
                           if (state.status === 'ready') confirm.run(state);
                        }}
                     >
                        {confirm.icon}
                        {confirm.label}
                     </Button>
                  </>
               ) : null}

               {busy ? (
                  <Button type="button" variant="outline" size="sm" disabled={!cancelable} onClick={flow.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' || state.status === 'failed' || finished || missing ? (
                  <Button type="button" size="sm" onClick={flow.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
