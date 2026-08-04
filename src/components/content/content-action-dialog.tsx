import type { ReactNode } from 'react';

import { useTranslations } from 'use-intl';

import type { ContentActionState } from '@/components/content/use-content-actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { InstallDetailRequest } from '@/modules/installs/contract';
import { useInstallDetail } from '@/modules/installs/renderer/use-install-detail';
import type { OperationSnapshot } from '@/modules/operations/contract';
import { isOperationFinished, OperationOutcome, OperationProgress, PreviewRow } from '@/modules/operations/renderer/operation-progress';
import { useTargets } from '@/modules/targets/renderer/use-targets';

type ContentActionDialogProps<OtherKind extends string, Problem, Preview, Selection> = {
   state: ContentActionState<OtherKind, Problem, Preview, Selection>;
   operation: OperationSnapshot | null;
   title: string;
   description: string | null;
   issue: ReactNode;
   preview: ReactNode;
   confirm: () => Promise<void>;
   cancel: () => void;
   dismiss: () => void;
   labels: {
      loading: string;
      failed: string;
      preparing: string;
      progress: (values: { copied: string; total: string; label: string }) => string;
      completed: string;
      cancelled: string;
      confirm: string;
   };
};

export function ContentActionDialog<OtherKind extends string, Problem, Preview, Selection>({
   state,
   operation,
   title,
   description,
   issue,
   preview,
   confirm,
   cancel,
   dismiss,
   labels
}: ContentActionDialogProps<OtherKind, Problem, Preview, Selection>) {
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
               <DialogTitle>{title}</DialogTitle>
               {description ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{labels.loading}</p> : null}
               {state.status === 'invalid' ? issue : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{labels.failed}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {preview}

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
                     <Button type="button" size="sm" variant="destructive" onClick={() => void confirm()}>
                        {labels.confirm}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' || state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

export function ActionScopeRows({
   request,
   showPath = true,
   compact = false
}: {
   request: InstallDetailRequest;
   showPath?: boolean;
   compact?: boolean;
}) {
   const t = useTranslations('common.scope');
   const { detail } = useInstallDetail(request);
   const { targets } = useTargets();
   const target = targets.find((candidate) => candidate.id === request.targetId) ?? null;
   const install = detail?.name ?? t('unknownInstall');
   const device = target?.name ?? t('unknownDevice');

   if (compact) return <p className="text-muted-foreground">{t('summary', { install, device })}</p>;

   return (
      <>
         <PreviewRow label={t('install')} value={install} />
         {showPath ? <PreviewRow label={t('path')} value={detail?.path ?? t('unknownPath')} /> : null}
         <PreviewRow label={t('device')} value={device} />
      </>
   );
}
