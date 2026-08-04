import { useTranslations } from 'use-intl';

import { ActionScopeRows } from '@/components/content/content-action-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { MessageKey } from '@/app/renderer/i18n/keys';
import type { InstallActionIssue, InstallActionRequest } from '@/modules/installs/contract';
import type { InstallActions } from '@/modules/installs/renderer/use-install-actions';
import { isOperationFinished, OperationOutcome, OperationProgress, PreviewRow } from '@/modules/operations/renderer/operation-progress';

const issueKeys: Record<InstallActionIssue, MessageKey<'installs.manage.issues'>> = {
   'inspect-failed': 'inspectFailed',
   'invalid-color': 'invalidColor',
   'invalid-name': 'invalidName',
   'not-found': 'notFound',
   'store-detected': 'storeDetected',
   'store-owned': 'storeOwned',
   'unsupported-target': 'unsupportedTarget'
};

export function InstallActionDialog({ request, actions }: { request: InstallActionRequest; actions: InstallActions }) {
   const t = useTranslations('installs.manage');
   const common = useTranslations('common');
   const format = useFormatters();
   const { state, operation } = actions;
   const running = (state.status === 'starting' && state.kind === 'delete') || (state.status === 'running' && !isOperationFinished(operation));
   const kind = state.status === 'idle' ? 'delete' : state.kind;

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || running) return;

            actions.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t(`${kind}.title`)}</DialogTitle>
               <DialogDescription>{t(`${kind}.description`)}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{t(`issues.${issueKeys[state.problem.issue]}`)}</p>
                     {state.problem.detail ? <p className="text-muted-foreground text-xs break-all">{state.problem.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t(`${kind}.result.failed`)}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'forgotten' ? <p>{t('forget.result.completed')}</p> : null}

               {state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? (
                  <>
                     <ActionScopeRows request={request} showPath={false} />

                     <PreviewRow label={t(`${state.kind}.path`)} value={state.preview.path} />

                     {state.kind === 'delete' ? (
                        <PreviewRow
                           label={t('size')}
                           value={t('sizeValue', { size: format.bytes(state.preview.sizeBytes), count: state.preview.fileCount })}
                        />
                     ) : null}
                  </>
               ) : null}

               {running && !operation ? <OperationProgress percent={0} label={t('delete.preparing')} /> : null}

               {state.status === 'running' && operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: (values) => t('delete.progress', values),
                        completed: t('delete.result.completed'),
                        cancelled: t('delete.result.cancelled'),
                        failed: t('delete.result.failed')
                     }}
                  />
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={actions.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button
                        type="button"
                        size="sm"
                        variant={state.kind === 'delete' ? 'destructive' : 'default'}
                        onClick={() => void actions.confirm()}
                     >
                        {t(`${state.kind}.confirm`)}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={actions.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' ||
               state.status === 'failed' ||
               state.status === 'forgotten' ||
               (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={actions.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
