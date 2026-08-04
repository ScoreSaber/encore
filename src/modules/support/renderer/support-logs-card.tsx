import { ClipboardCopy, ExternalLink, FileText, Save } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { ErrorPanel, LoadingPanel } from '@/components/state/state-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { SupportLogGroup, SupportLogSelection } from '@/modules/support/contract';
import { LogPreview } from '@/modules/support/renderer/log-preview';
import { supportLogIssueKeys } from '@/modules/support/renderer/support-log-issue-keys';
import type { Support } from '@/modules/support/renderer/use-support';

export function SupportLogsCard({ support, showInstallLogs = true }: { support: Support; showInstallLogs?: boolean }) {
   const t = useTranslations('home.logs');
   const common = useTranslations('common');
   const groups = (support.snapshot?.groups ?? []).filter((group) => showInstallLogs || group.source !== 'install');
   const busy = support.logActionStatus !== 'idle';
   const logReady = support.selectedLog.status === 'ready';

   return (
      <>
         <section className="mt-6 flex min-w-0 flex-col gap-4 border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
               <h2 className="text-base font-semibold tracking-tight">{t('title')}</h2>
               <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={support.diagnostics.status === 'building'}
                  onClick={() => void support.buildDiagnostics()}
               >
                  <ClipboardCopy data-icon="inline-start" />
                  {t('supportInfo')}
               </Button>
            </div>
            <div className="flex flex-col gap-4 text-sm">
               {support.loadStatus === 'error' ? <ErrorPanel message={t('loadError')} /> : null}

               {support.loadStatus === 'loading' ? <LoadingPanel rows={2} /> : null}

               {support.loadStatus === 'ready'
                  ? groups.map((group) => <LogGroup key={group.source} group={group} onSelect={support.selectLog} />)
                  : null}
            </div>
         </section>

         <Dialog open={support.selection !== null} onOpenChange={(open) => !open && support.closeLog()}>
            <DialogContent className="sm:max-w-3xl">
               <DialogHeader>
                  <DialogTitle className="break-all">{support.selection?.fileId}</DialogTitle>
                  <DialogDescription className="sr-only">{t('actionDescription')}</DialogDescription>
               </DialogHeader>
               {support.selectedLog.status === 'loading' ? <p className="text-muted-foreground text-sm">{common('loading')}</p> : null}
               {support.selectedLog.status === 'error' ? <p className="text-sm">{t('issues.unreadable')}</p> : null}
               {support.selectedLog.status === 'unavailable' ? (
                  <p className="text-sm">{t(`issues.${supportLogIssueKeys[support.selectedLog.issue]}`)}</p>
               ) : null}
               {support.selectedLog.status === 'ready' ? <LogPreview className="h-[28rem]" text={support.selectedLog.text} /> : null}
               <DialogFooter>
                  <Button type="button" variant="outline" disabled={busy} onClick={support.closeLog}>
                     {common('cancel')}
                  </Button>
                  <ButtonGroup aria-label={t('actionDescription')}>
                     <Button type="button" variant="outline" disabled={busy || !logReady} onClick={() => void support.copySelectedLog()}>
                        <ClipboardCopy data-icon="inline-start" />
                        {t('copy')}
                     </Button>
                     <Button type="button" variant="outline" disabled={busy || !logReady} onClick={() => void support.saveSelectedLog()}>
                        <Save data-icon="inline-start" />
                        {t('save')}
                     </Button>
                     <Button type="button" disabled={busy || !logReady} onClick={() => void support.openSelectedLog()}>
                        <ExternalLink data-icon="inline-start" />
                        {t('open')}
                     </Button>
                  </ButtonGroup>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </>
   );
}

function LogGroup({ group, onSelect }: { group: SupportLogGroup; onSelect: (selection: SupportLogSelection) => void }) {
   const t = useTranslations('home.logs');
   const files: { key: string; label: string; selection: SupportLogSelection }[] =
      group.source === 'install'
         ? group.files.map((file) => ({
              key: `${file.installId}:${file.id}`,
              label: `${file.installName} / ${file.id}`,
              selection: { source: 'install', installId: file.installId, fileId: file.id }
           }))
         : group.files.map((file) => ({
              key: file.id,
              label: file.id,
              selection: { source: 'app', fileId: file.id }
           }));

   return (
      <div className="flex flex-col gap-1">
         <span className="font-medium">{t(`source.${group.source}`)}</span>

         {group.status === 'ready' && group.files.length > 0 ? (
            <div className={`flex flex-col overflow-y-auto ${group.source === 'install' ? 'max-h-28' : 'max-h-21'}`}>
               {files.map((file) => (
                  <button
                     key={file.key}
                     type="button"
                     className="hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-2 py-1 text-left"
                     onClick={() => onSelect(file.selection)}
                  >
                     <FileText className="size-4 shrink-0" />
                     <span className="min-w-0 flex-1 truncate">{file.label}</span>
                  </button>
               ))}
            </div>
         ) : (
            <p className="text-muted-foreground text-xs">{t(`groupStatus.${group.status === 'ready' ? 'empty' : group.status}`)}</p>
         )}
      </div>
   );
}
