import { useTranslations } from 'use-intl';

import { ActionScopeRows } from '@/components/content/content-action-dialog';
import { WarningLine } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { useFormatters } from '@/app/renderer/i18n/formatters';
import type { InstallActionRequest } from '@/modules/installs/contract';
import type {
   ModWarning,
   ReadyModChangesPreview,
   ReadyModImportPreview,
   ReadyModInstallPreview,
   ReadyModUninstallPreview
} from '@/modules/mods/contract';
import { modIssueKeys, modWarningKeys } from '@/modules/mods/renderer/mod-issue-keys';
import type { InstallMods } from '@/modules/mods/renderer/use-install-mods';
import { isOperationFinished, OperationOutcome, OperationProgress, PreviewList, PreviewRow } from '@/modules/operations/renderer/operation-progress';

export function ModActionDialog({ request, mods }: { request: InstallActionRequest; mods: InstallMods }) {
   const t = useTranslations('mods');
   const common = useTranslations('common');
   const { state, operation } = mods;
   const running = state.status === 'starting' || (state.status === 'running' && !isOperationFinished(operation));
   const kind = state.status === 'idle' ? 'install' : state.kind;
   const title =
      (state.status === 'ready' || state.status === 'starting' || state.status === 'running') &&
      (state.kind === 'install' || state.kind === 'uninstall')
         ? t(`${state.kind}.action`, { count: state.preview.mods.length })
         : t(`${kind}.title`);

   return (
      <Dialog
         open={state.status !== 'idle'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || running) return;

            mods.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{title}</DialogTitle>
               <DialogDescription>{t(`${kind}.description`)}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{t(`issues.${modIssueKeys[state.problem.issue]}`)}</p>
                     {state.problem.detail ? <p className="text-muted-foreground text-xs break-all">{state.problem.detail}</p> : null}
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t(`${kind}.result.failed`)}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' || state.status === 'starting' || state.status === 'running' ? (
                  <>
                     <ActionScopeRows
                        request={request}
                        showPath={state.kind !== 'uninstall'}
                        compact={state.kind === 'install' || state.kind === 'uninstall' || state.kind === 'changes'}
                     />

                     {state.kind === 'install' ? <InstallPreview preview={state.preview} /> : null}
                     {state.kind === 'uninstall' ? <UninstallPreview preview={state.preview} /> : null}
                     {state.kind === 'changes' ? <ChangesPreview preview={state.preview} /> : null}
                     {state.kind === 'import' ? <ImportPreview preview={state.preview} /> : null}
                     <Warnings warnings={state.preview.warnings} />
                  </>
               ) : null}

               {state.status === 'starting' || (state.status === 'running' && !operation) ? (
                  <OperationProgress percent={0} label={t(`${kind}.preparing`)} />
               ) : null}

               {state.status === 'running' && operation ? (
                  <OperationOutcome
                     operation={operation}
                     labels={{
                        progress: (values) => t(`${kind}.progress`, values),
                        completed: t(`${kind}.result.completed`),
                        cancelled: t(`${kind}.result.cancelled`),
                        failed: t(`${kind}.result.failed`)
                     }}
                  />
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={mods.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button
                        type="button"
                        size="sm"
                        variant={state.kind === 'uninstall' ? 'destructive' : 'default'}
                        onClick={() => void mods.confirm()}
                     >
                        {t(`${state.kind}.confirm`)}
                     </Button>
                  </>
               ) : null}

               {running ? (
                  <Button type="button" variant="outline" size="sm" disabled={state.status === 'starting'} onClick={mods.cancel}>
                     {common('cancel')}
                  </Button>
               ) : null}

               {state.status === 'invalid' || state.status === 'failed' || (state.status === 'running' && isOperationFinished(operation)) ? (
                  <Button type="button" size="sm" onClick={mods.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}

function ChangesPreview({ preview }: { preview: ReadyModChangesPreview }) {
   const t = useTranslations('mods');

   return (
      <>
         <p className="font-medium">{t('changes.install')}</p>
         <InstallPreview preview={preview.install} />
         <p className="font-medium">{t('changes.remove')}</p>
         <UninstallPreview preview={preview.uninstall} />
      </>
   );
}

function InstallPreview({ preview }: { preview: ReadyModInstallPreview }) {
   const t = useTranslations('mods');
   const format = useFormatters();

   return (
      <>
         <PreviewList
            items={preview.mods.map((mod) => ({
               id: mod.modId,
               label: `${mod.name}${mod.reason === 'dependency' ? ` ${t('install.dependency')}` : ''}`,
               detail: mod.version
            }))}
         />
         <p className="text-muted-foreground text-xs">{t('install.downloadSize', { size: format.bytes(preview.downloadBytes) })}</p>
      </>
   );
}

function UninstallPreview({ preview }: { preview: ReadyModUninstallPreview }) {
   const t = useTranslations('mods');

   return (
      <>
         <PreviewList items={preview.mods.map((mod) => ({ id: mod.modId, label: mod.name, detail: mod.version }))} />
         <p className="text-muted-foreground text-xs">{t('uninstall.fileCount', { count: preview.fileCount })}</p>
         {preview.external.length > 0 ? (
            <p className="text-muted-foreground text-xs">{t('uninstall.externalCount', { count: preview.external.length })}</p>
         ) : null}
      </>
   );
}

function ImportPreview({ preview }: { preview: ReadyModImportPreview }) {
   const t = useTranslations('mods');
   const format = useFormatters();

   return (
      <>
         <PreviewRow label={t('import.source')} value={preview.sourcePath} />
         <PreviewRow label={t('import.destination')} value={preview.destinationPath} />
         <PreviewRow label={t('size')} value={format.bytes(preview.sizeBytes)} />
      </>
   );
}

function Warnings({ warnings }: { warnings: ModWarning[] }) {
   const t = useTranslations('mods');

   return warnings.map((warning) => <WarningLine key={warning}>{t(`warnings.${modWarningKeys[warning]}`)}</WarningLine>);
}
