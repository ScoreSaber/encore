import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { InstallImporter } from '@/modules/installs/renderer/use-install-import';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';

export function ImportInstallDialog({ importer }: { importer: InstallImporter }) {
   const t = useTranslations('installs');
   const common = useTranslations('common');
   const problems = useTranslations('problems.installs.import');
   const { state } = importer;
   const open = state.status !== 'idle' && state.status !== 'choosing';
   const busy = state.status === 'registering';

   return (
      <Dialog
         open={open}
         onOpenChange={(nextOpen) => {
            if (nextOpen || busy) return;

            importer.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('import.title')}</DialogTitle>
               <DialogDescription>{t('import.description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'previewing' ? <p className="text-muted-foreground">{common('loading')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{problems(state.preview.issue)}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.preview.sourcePath}</p>
                  </>
               ) : null}

               {state.status === 'failed' ? (
                  <>
                     <p>{t('import.result.failed')}</p>
                     <p className="text-muted-foreground text-xs break-all">{state.error.message}</p>
                  </>
               ) : null}

               {state.status === 'ready' || state.status === 'registering' || state.status === 'registered' ? (
                  <>
                     <PreviewRow label={t('import.folder')} value={state.preview.sourcePath} />
                     <PreviewRow label={t('import.version')} value={state.preview.version} />
                     {state.status === 'registered' ? <p>{t('import.result.completed')}</p> : null}
                  </>
               ) : null}
            </div>

            <DialogFooter>
               {state.status === 'ready' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={importer.dismiss}>
                        {common('cancel')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => void importer.confirm()}>
                        {t('import.confirm')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'registering' ? (
                  <Button type="button" size="sm" disabled>
                     {t('import.confirm')}
                  </Button>
               ) : null}

               {state.status === 'invalid' ? (
                  <>
                     <Button type="button" variant="outline" size="sm" onClick={importer.dismiss}>
                        {common('close')}
                     </Button>
                     <Button type="button" size="sm" onClick={() => void importer.choose(state.targetId)}>
                        {t('import.chooseAnother')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'failed' || state.status === 'registered' ? (
                  <Button type="button" size="sm" onClick={importer.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
