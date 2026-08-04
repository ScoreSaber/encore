import type { ReactNode } from 'react';

import { Download } from 'lucide-react';
import { useTranslations } from 'use-intl';

import type { ContentLinkState } from '@/components/content/use-content-link';
import type { ContentLinkInstall } from '@/components/content/use-content-link';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { OperationSnapshot } from '@/modules/operations/contract';
import { isOperationFinished, OperationOutcome, OperationProgress } from '@/modules/operations/renderer/operation-progress';

type ContentLinkDialogProps<Source, Issue> = {
   state: ContentLinkState<Source, Issue>;
   operation: OperationSnapshot | null;
   installs: ContentLinkInstall[];
   selectedInstallKey: string | null;
   selectInstall: (key: string) => void;
   confirm: () => Promise<void>;
   cancel: () => void;
   dismiss: () => void;
   issue: ReactNode;
   preview: ReactNode;
   labels: {
      title: string;
      description: string;
      failed: string;
      preparing: string;
      progress: (values: { copied: string; total: string; label: string }) => string;
      completed: string;
      cancelled: string;
      noInstalls: string;
      install: string;
      confirm: string;
   };
};

export function ContentLinkDialog<Source, Issue>({
   state,
   operation,
   installs,
   selectedInstallKey,
   selectInstall,
   confirm,
   cancel,
   dismiss,
   issue,
   preview,
   labels
}: ContentLinkDialogProps<Source, Issue>) {
   const common = useTranslations('common');
   const running = state.status === 'starting' || (state.status === 'running' && !isOperationFinished(operation));

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || running) return;

            dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{labels.title}</DialogTitle>
               <DialogDescription>{labels.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'rejected' ? issue : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{labels.failed}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? (
                  <>
                     {preview}
                     {installs.length === 0 ? (
                        <p className="text-muted-foreground">{labels.noInstalls}</p>
                     ) : (
                        <div className="flex flex-col gap-1.5">
                           <span className="text-muted-foreground text-xs">{labels.install}</span>
                           <Select value={selectedInstallKey ?? undefined} disabled={state.status !== 'ready'} onValueChange={selectInstall}>
                              <SelectTrigger className="w-full">
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                 <SelectGroup>
                                    {installs.map((install) => (
                                       <SelectItem key={install.key} value={install.key}>
                                          {install.targetName} — {install.name}
                                       </SelectItem>
                                    ))}
                                 </SelectGroup>
                              </SelectContent>
                           </Select>
                        </div>
                     )}
                  </>
               ) : null}

               {state.status === 'starting' || (state.status === 'running' && !operation) ? (
                  <OperationProgress percent={0} label={labels.preparing} />
               ) : null}

               {state.status === 'running' && operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: labels.progress,
                        completed: labels.completed,
                        cancelled: labels.cancelled,
                        failed: labels.failed
                     }}
                  />
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" disabled={!selectedInstallKey} onClick={() => void confirm()}>
                        <Download data-icon="inline-start" />
                        {labels.confirm}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'rejected' || state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
