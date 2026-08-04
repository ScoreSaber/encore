import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { BSManagerCleanup } from '@/modules/bsmanager/renderer/use-bsmanager-cleanup';
import { isOperationFinished, OperationOutcome, OperationProgress, PreviewRow } from '@/modules/operations/renderer/operation-progress';

export function BSManagerCleanupDialog({ cleanup, onChanged }: { cleanup: BSManagerCleanup; onChanged: () => void }) {
   const t = useTranslations('bsmanager.cleanup');
   const common = useTranslations('common');
   const { state, operation } = cleanup;
   const running = state.status === 'starting' || (state.status === 'running' && !isOperationFinished(operation));
   const close = () => {
      cleanup.dismiss();
      onChanged();
   };

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(open) => {
            if (!open && !running) close();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{cleanup.plan ? t('description', { path: cleanup.plan.sharedContentPath }) : t('failed')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'confirming' ? (
                  <ul className="divide-border rounded-md border">
                     {cleanup.affectedVersions.map((version) => {
                        const count = version.folders.filter((folder) => folder.state === 'foreign').length;

                        return (
                           <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2">
                              <span>{version.name ?? version.version}</span>
                              <span className="text-muted-foreground text-xs">{t('links', { count })}</span>
                           </li>
                        );
                     })}
                  </ul>
               ) : null}

               {state.status === 'starting' ? <OperationProgress percent={0} label={common('operation.preparing')} /> : null}
               {state.status === 'running' && operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: (values) => t('progress', values),
                        completed: t('completed'),
                        cancelled: t('cancelled'),
                        failed: t('failed')
                     }}
                  />
               ) : null}
               {state.status === 'failed' ? <PreviewRow label={t('failed')} value={state.error.message} /> : null}
            </div>

            <DialogFooter>
               {state.status === 'confirming' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={close}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => void cleanup.start()}>
                        {t('confirm')}
                     </Button>
                  </>
               ) : null}
               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={cleanup.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}
               {state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={close}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
