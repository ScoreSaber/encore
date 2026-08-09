import { CircleAlert, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ActionScopeRows } from '@/components/content/content-action-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { isOperationFinished, OperationOutcome, OperationProgress } from '@/modules/operations/renderer/operation-progress';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import {
   isContentsModeAllowed,
   sharedContentsModeSchema,
   type ReadySharedContentPreview,
   type SharedContentsMode
} from '@/modules/shared-content/contract';
import { sharedContentIssueKeys } from '@/modules/shared-content/renderer/shared-folder-actions';
import type { SharedContentActions } from '@/modules/shared-content/renderer/use-shared-content-actions';
import { useFormatters } from '@/renderer/i18n/formatters';

export function SharedContentActionDialog({ request, actions }: { request: TargetSharedContentRequest; actions: SharedContentActions }) {
   const t = useTranslations('sharedContent.actions');
   const issues = useTranslations('sharedContent.issues');
   const common = useTranslations('common');
   const { state, operation } = actions;
   const running = state.status === 'starting' || (state.status === 'running' && !isOperationFinished(operation));
   const action = state.status === 'idle' ? 'link' : state.action;
   const preview = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.preview : null;

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || running) return;

            actions.dismiss();
         }}
      >
         <DialogContent className="sm:max-w-xl">
            <DialogHeader>
               <DialogTitle>{t(`${action}.title`)}</DialogTitle>
               <DialogDescription>{t(`${action}.description`)}</DialogDescription>
               {preview ? <ActionScopeRows request={request} compact /> : null}
            </DialogHeader>

            <div className="flex flex-col gap-4 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <Alert variant="warning">
                     <CircleAlert />
                     <AlertTitle>{issues(sharedContentIssueKeys[state.problem.issue])}</AlertTitle>
                     {state.problem.detail ? <AlertDescription className="break-all">{state.problem.detail}</AlertDescription> : null}
                  </Alert>
               ) : null}

               {state.status === 'failed' ? (
                  <Alert variant="destructive">
                     <CircleAlert />
                     <AlertTitle>{t('result.failed')}</AlertTitle>
                     <AlertDescription className="break-all">{state.error.message}</AlertDescription>
                  </Alert>
               ) : null}

               <ActionPreview preview={preview} />

               {state.status === 'ready' ? <ContentsChoice preview={state.preview} onChange={actions.setContents} /> : null}

               {state.status === 'starting' || (state.status === 'running' && !operation) ? (
                  <OperationProgress percent={0} label={common('operation.preparing')} />
               ) : null}

               {state.status === 'running' && operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: (values) => common('operation.progress', values),
                        completed: t('result.completed'),
                        cancelled: t('result.cancelled'),
                        failed: t('result.failed')
                     }}
                  />
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" onClick={actions.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" onClick={() => void actions.confirm()}>
                        {t(`${action}.confirm`)}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" disabled={state.status === 'starting'} onClick={actions.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' || state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" onClick={actions.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function ActionPreview({ preview }: { preview: ReadySharedContentPreview | null }) {
   const t = useTranslations('sharedContent.actions');
   const shared = useTranslations('sharedContent');
   const warnings = useTranslations('sharedContent.warnings');
   const format = useFormatters();

   if (!preview) return null;

   const notices = [
      preview.conflictCount > 0 ? t('conflictsValue', { count: preview.conflictCount }) : null,
      preview.warnings.includes('move-blocked') ? warnings('move-blocked') : null,
      preview.warnings.includes('risky-folder') ? warnings('risky-folder') : null
   ].filter((notice): notice is string => notice !== null);

   return (
      <div className="flex flex-col gap-3">
         <div className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="font-medium">{shared(`folders.${preview.folderId}`)}</div>
            <dl className="grid grid-cols-2 gap-3">
               <div>
                  <dt className="text-muted-foreground text-xs">{t('installContents')}</dt>
                  <dd>{t('contentsValue', { size: format.bytes(preview.installBytes), files: preview.installFiles })}</dd>
               </div>
               <div>
                  <dt className="text-muted-foreground text-xs">{t('sharedContents')}</dt>
                  <dd>{t('contentsValue', { size: format.bytes(preview.sharedBytes), files: preview.sharedFiles })}</dd>
               </div>
               {preview.linkedInstalls.length > 0 ? (
                  <div className="col-span-2">
                     <dt className="text-muted-foreground text-xs">{t('linkedInstalls')}</dt>
                     <dd>{preview.linkedInstalls.join(', ')}</dd>
                  </div>
               ) : null}
            </dl>
         </div>

         {notices.length > 0 ? (
            <Alert variant="warning">
               <TriangleAlert />
               <AlertTitle>{t('review')}</AlertTitle>
               <AlertDescription>
                  {notices.map((notice) => (
                     <p key={notice}>{notice}</p>
                  ))}
               </AlertDescription>
            </Alert>
         ) : null}
      </div>
   );
}

function ContentsChoice({ preview, onChange }: { preview: ReadySharedContentPreview; onChange: (contents: SharedContentsMode) => void }) {
   const t = useTranslations('sharedContent.actions');
   const modes = sharedContentsModeSchema.options.filter((mode) => isContentsModeAllowed(preview.action, mode));

   if (modes.length < 2) return null;

   return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
         <div className="font-medium">{t(`contentsChoice.${preview.action === 'unlink' ? 'unlink' : 'link'}`)}</div>
         <ToggleGroup
            className="w-full"
            type="single"
            variant="outline"
            value={preview.contents}
            onValueChange={(next) => {
               if (next) onChange(sharedContentsModeSchema.parse(next));
            }}
         >
            {modes.map((mode) => (
               <ToggleGroupItem key={mode} className="flex-1" value={mode}>
                  {t(`contents.${mode}`)}
               </ToggleGroupItem>
            ))}
         </ToggleGroup>
         <p className="text-muted-foreground text-xs">
            {preview.contents === 'move'
               ? t(`contentsHint.move.${preview.action === 'unlink' ? 'unlink' : 'link'}`)
               : t(`contentsHint.${preview.contents}`)}
         </p>
      </div>
   );
}
