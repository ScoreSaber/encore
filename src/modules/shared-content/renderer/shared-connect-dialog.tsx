import { useTranslations } from 'use-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { useFormatters } from '@/app/renderer/i18n/formatters';
import { isOperationFinished, OperationOutcome, OperationProgress, PreviewRow } from '@/modules/operations/renderer/operation-progress';
import {
   isConnectContentsAllowed,
   sharedContentsModeSchema,
   type ReadySharedConnectPreview,
   type SharedContentsMode
} from '@/modules/shared-content/contract';
import { sharedContentIssueKeys, SharedFolderStateBadge } from '@/modules/shared-content/renderer/shared-folder-actions';
import type { SharedConnect } from '@/modules/shared-content/renderer/use-shared-connect';

export function SharedConnectDialog({ connect }: { connect: SharedConnect }) {
   const t = useTranslations('sharedContent.connect');
   const actions = useTranslations('sharedContent.actions');
   const issues = useTranslations('sharedContent.issues');
   const common = useTranslations('common');
   const { state, operation } = connect;
   const running = state.status === 'starting' || (state.status === 'running' && !isOperationFinished(operation));
   const action = state.status === 'idle' ? 'connect' : state.action;
   const preview = state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? state.preview : null;

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || running) return;

            connect.dismiss();
         }}
      >
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <DialogTitle>{t(`${action}.title`)}</DialogTitle>
               <DialogDescription>{t(`${action}.description`)}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status !== 'idle' ? <PreviewRow label={t('install')} value={state.installName} /> : null}
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{issues(sharedContentIssueKeys[state.problem.issue])}</p>
                     {state.problem.detail ? <p className="text-muted-foreground text-xs break-all">{state.problem.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{actions('result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {preview ? <ConnectPreview preview={preview} /> : null}

               {state.status === 'ready' ? (
                  <>
                     <ContentsChoice preview={state.preview} onChange={connect.setContents} />
                     <RiskyChoice preview={state.preview} onChange={connect.setIncludeRisky} />
                  </>
               ) : null}

               {state.status === 'starting' || (state.status === 'running' && !operation) ? (
                  <OperationProgress percent={0} label={common('operation.preparing')} />
               ) : null}

               {state.status === 'running' && operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: (values) => common('operation.progress', values),
                        completed: actions('result.completed'),
                        cancelled: actions('result.cancelled'),
                        failed: actions('result.failed')
                     }}
                  />
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={connect.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button
                        type="button"
                        size="sm"
                        disabled={state.preview.folders.every((folder) => folder.step === 'skip')}
                        onClick={() => void connect.confirm()}
                     >
                        {t(`${action}.confirm`)}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={connect.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' || state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={connect.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function ConnectPreview({ preview }: { preview: ReadySharedConnectPreview }) {
   const t = useTranslations('sharedContent.connect');
   const shared = useTranslations('sharedContent');
   const actions = useTranslations('sharedContent.actions');
   const warnings = useTranslations('sharedContent.warnings');
   const format = useFormatters();
   const planned = preview.folders.filter((folder) => folder.step !== 'skip');

   return (
      <>
         <PreviewRow label={t('root')} value={preview.rootPath} />

         <div className="max-h-64 overflow-auto rounded-md border">
            <Table>
               <TableHeader>
                  <TableRow>
                     <TableHead>{shared('columns.folder')}</TableHead>
                     <TableHead>{shared('columns.state')}</TableHead>
                     <TableHead>{t('columns.plan')}</TableHead>
                     <TableHead className="text-right">{t('columns.contents')}</TableHead>
                  </TableRow>
               </TableHeader>
               <TableBody>
                  {preview.folders.map((folder) => (
                     <TableRow key={folder.id} className={folder.step === 'skip' ? 'opacity-60' : undefined}>
                        <TableCell className="min-w-0 whitespace-normal">
                           <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{shared(`folders.${folder.id}`)}</span>
                              {folder.risky ? <Badge variant="secondary">{shared('risky')}</Badge> : null}
                           </div>
                        </TableCell>
                        <TableCell>
                           <SharedFolderStateBadge state={folder.state} />
                        </TableCell>
                        <TableCell className="text-xs">{t(`steps.${folder.step}`)}</TableCell>
                        <TableCell className="text-muted-foreground text-right text-xs whitespace-nowrap">
                           {folder.step !== 'skip' && folder.files > 0
                              ? actions('contentsValue', { size: format.bytes(folder.bytes), files: folder.files })
                              : null}
                           {folder.conflictCount > 0 ? <div>{t('conflicts', { count: folder.conflictCount })}</div> : null}
                        </TableCell>
                     </TableRow>
                  ))}
               </TableBody>
            </Table>
         </div>

         {planned.length === 0 ? <p className="text-muted-foreground text-xs">{t('nothingPlanned')}</p> : null}

         {preview.warnings.map((warning) => (
            <p key={warning} className="text-muted-foreground text-xs">
               {warnings(warning)}
            </p>
         ))}
      </>
   );
}

function ContentsChoice({ preview, onChange }: { preview: ReadySharedConnectPreview; onChange: (contents: SharedContentsMode) => void }) {
   const t = useTranslations('sharedContent.actions');
   const connect = useTranslations('sharedContent.connect');
   const modes = sharedContentsModeSchema.options.filter((mode) => isConnectContentsAllowed(preview.action, mode));

   if (modes.length < 2) return null;

   return (
      <div className="flex flex-col gap-2">
         <div className="font-medium">{t(`contentsChoice.${preview.action === 'disconnect' ? 'unlink' : 'link'}`)}</div>
         <ToggleGroup
            className="flex-wrap justify-start"
            type="single"
            spacing={2}
            value={preview.contents}
            onValueChange={(next) => {
               if (next) onChange(sharedContentsModeSchema.parse(next));
            }}
         >
            {modes.map((mode) => (
               <ToggleGroupItem key={mode} value={mode}>
                  {t(`contents.${mode}`)}
               </ToggleGroupItem>
            ))}
         </ToggleGroup>
         <p className="text-muted-foreground text-xs">{connect(`contentsHint.${preview.contents}`)}</p>
      </div>
   );
}

function RiskyChoice({ preview, onChange }: { preview: ReadySharedConnectPreview; onChange: (includeRisky: boolean) => void }) {
   const t = useTranslations('sharedContent.connect');

   if (preview.action !== 'connect') return null;

   return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2">
         <div className="min-w-0">
            <Label htmlFor="shared-connect-risky">{t('includeRisky')}</Label>
            <p className="text-muted-foreground text-xs">{t('includeRiskyHint')}</p>
         </div>
         <Switch id="shared-connect-risky" checked={preview.includeRisky} onCheckedChange={onChange} />
      </div>
   );
}
