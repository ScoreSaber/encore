import type { ReactNode } from 'react';

import { CheckCircle2, Download } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { OperationProgress } from '@/modules/operations/renderer/operation-progress';
import { contentLinkDestinationName } from '@/modules/shared-content/renderer/content-link-destinations';
import type { ContentLink, ContentLinkProgress } from '@/modules/shared-content/renderer/use-content-link';
import { useFormatters } from '@/renderer/i18n/formatters';

export function ContentLinkDialog<Source, Problem extends { detail?: string }>({
   link,
   issue,
   preview,
   labels
}: {
   link: ContentLink<Source, Problem>;
   issue: (problem: Problem) => string;
   preview: (source: Source) => ReactNode;
   labels: {
      title: string;
      description: string;
      failed: string;
      completed: string;
      cancelled: string;
      noInstalls: string;
      destination: string;
      confirm: string;
   };
}) {
   const common = useTranslations('common');
   const sharedRoots = useTranslations('sharedContent.roots');
   const { state } = link;
   const destinationName = (destination: (typeof link.destinations)[number]) =>
      `${destination.targetName} · ${contentLinkDestinationName(destination, sharedRoots('sharedContentName'))}`;

   return (
      <Dialog
         open={state.status !== 'idle' && !link.hidden}
         onOpenChange={(nextOpen) => {
            if (nextOpen || link.hidden || link.busy) return;

            link.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{labels.title}</DialogTitle>
               <DialogDescription>{labels.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
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

               {state.status === 'ready' || state.status === 'running' ? preview(state.source) : null}

               {state.status === 'ready' ? (
                  link.destinations.length === 0 ? (
                     <p className="text-muted-foreground">{labels.noInstalls}</p>
                  ) : (
                     <div className="flex flex-col gap-1.5">
                        <span className="text-muted-foreground text-xs">{labels.destination}</span>
                        <ul className="divide-border flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border">
                           {link.destinations.map((destination) => (
                              <li key={destination.key}>
                                 <label className="hover:bg-muted/60 flex items-center gap-3 px-3 py-2.5">
                                    <Checkbox
                                       checked={link.selectedKeys.has(destination.key)}
                                       onCheckedChange={(checked) => link.toggleDestination(destination.key, checked === true)}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{destinationName(destination)}</span>
                                 </label>
                              </li>
                           ))}
                        </ul>
                     </div>
                  )
               ) : null}

               {state.status === 'running' ? (
                  <ul className="divide-border flex flex-col divide-y rounded-lg border">
                     {link.progress.map((run) => (
                        <li key={run.destination.key} className="flex flex-col gap-2 px-3 py-2.5">
                           <div className="flex items-center gap-3">
                              <span className="min-w-0 flex-1 truncate">{destinationName(run.destination)}</span>
                              {run.operation?.status === 'completed' ? <CheckCircle2 className="text-status-success size-4 shrink-0" /> : null}
                           </div>
                           <RunStatus run={run} labels={labels} />
                        </li>
                     ))}
                  </ul>
               ) : null}

               {link.allCompleted ? <p>{labels.completed}</p> : null}

               {state.status === 'ready' && link.destinations.length > 0 ? (
                  <label className="flex items-start gap-2">
                     <Checkbox checked={link.remember} onCheckedChange={(checked) => link.setRemember(checked === true)} />
                     <span className="min-w-0 break-words">{common('rememberDownload')}</span>
                  </label>
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={link.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" disabled={link.selectedKeys.size === 0} onClick={link.confirm}>
                        <Download data-icon="inline-start" />
                        {labels.confirm}
                     </Button>
                  </>
               ) : null}

               {link.busy ? (
                  <Button type="button" variant="outline" size="sm" disabled={!link.canCancel} onClick={link.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' || state.status === 'failed' || link.finished ? (
                  <Button type="button" size="sm" onClick={link.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function RunStatus({ run, labels }: { run: ContentLinkProgress; labels: { failed: string; cancelled: string } }) {
   const common = useTranslations('common');
   const format = useFormatters();
   const { operation, started } = run;

   if (started && !started.ok) return <p className="text-destructive text-xs break-words">{started.error.message}</p>;
   if (run.missing) return <p className="text-destructive text-xs break-words">{labels.failed}</p>;
   if (operation?.status === 'completed') return null;
   if (operation?.status === 'cancelled') return <p className="text-muted-foreground text-xs">{labels.cancelled}</p>;
   if (operation?.status === 'failed') return <p className="text-destructive text-xs break-words">{operation.error?.message ?? labels.failed}</p>;

   const progress = operation?.progress;
   const unitValue = (value: number) => (progress?.unit === 'bytes' || progress?.unit === undefined ? format.bytes(value) : format.count(value));
   return (
      <OperationProgress
         percent={Math.min(Math.max(progress?.percent ?? 0, 0), 100)}
         label={
            progress
               ? common('operation.progress', {
                    copied: unitValue(progress.current ?? 0),
                    total: unitValue(progress.total ?? 0),
                    label: progress.label ?? ''
                 })
               : common('operation.preparing')
         }
      />
   );
}
