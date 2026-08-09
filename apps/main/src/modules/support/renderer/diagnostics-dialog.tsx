import { ClipboardCopy, Save } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { LogPreview } from '@/modules/support/renderer/log-preview';
import { supportLogIssueKeys } from '@/modules/support/renderer/support-log-issue-keys';
import type { Support } from '@/modules/support/renderer/use-support';
import { useFormatters } from '@/renderer/i18n/formatters';

export function DiagnosticsDialog({ support }: { support: Support }) {
   const t = useTranslations('home.diagnostics');
   const logs = useTranslations('home.logs');
   const common = useTranslations('common');
   const format = useFormatters();
   const state = support.diagnostics;
   const bundle = state.status === 'exporting' || state.status === 'ready' ? state.bundle : null;
   const exporting = state.status === 'exporting';

   return (
      <Dialog
         open={state.status !== 'closed'}
         onOpenChange={(nextOpen) => {
            if (nextOpen || exporting) return;

            support.closeDiagnostics();
         }}
      >
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('description')}</DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-2 text-sm">
               {state.status === 'building' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'failed' ? <p>{t('failed')}</p> : null}

               {bundle ? (
                  <>
                     <p className="text-muted-foreground text-xs">{t('meta', { name: bundle.fileName, size: format.bytes(bundle.sizeBytes) })}</p>

                     {bundle.logs.map((log) =>
                        log.included ? null : (
                           <p key={log.fileId} className="text-muted-foreground text-xs">
                              {t('logExcluded', {
                                 file: log.fileId,
                                 reason: logs(`issues.${supportLogIssueKeys[log.issue]}`)
                              })}
                           </p>
                        )
                     )}

                     <LogPreview className="h-72" text={bundle.text} />
                  </>
               ) : null}
            </div>

            <DialogFooter>
               <Button type="button" variant="outline" disabled={exporting} onClick={support.closeDiagnostics}>
                  {common('cancel')}
               </Button>
               <ButtonGroup aria-label={t('title')}>
                  <Button type="button" variant="outline" disabled={!bundle || exporting} onClick={() => void support.exportDiagnostics('clipboard')}>
                     <ClipboardCopy data-icon="inline-start" />
                     {t('copy')}
                  </Button>
                  <Button type="button" disabled={!bundle || exporting} onClick={() => void support.exportDiagnostics('file')}>
                     <Save data-icon="inline-start" />
                     {t('save')}
                  </Button>
               </ButtonGroup>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
