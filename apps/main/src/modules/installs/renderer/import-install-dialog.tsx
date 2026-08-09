import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import type { InstallImportIssue } from '@/modules/installs/contract';
import type { InstallImporter } from '@/modules/installs/renderer/use-install-import';
import { PreviewRow } from '@/modules/operations/renderer/operation-progress';
import type { MessageKey } from '@/renderer/i18n/keys';

const issueKeys: Record<InstallImportIssue, MessageKey<'installs.import.issues'>> = {
   'already-registered': 'alreadyRegistered',
   'inspect-failed': 'inspectFailed',
   'missing-executable': 'missingExecutable',
   'missing-game-data': 'missingGameData',
   'not-a-directory': 'notADirectory',
   'not-absolute': 'notAbsolute',
   'not-found': 'notFound',
   'unknown-version': 'unknownVersion'
};

export function ImportInstallDialog({ importer }: { importer: InstallImporter }) {
   const t = useTranslations('installs');
   const common = useTranslations('common');
   const { state } = importer;
   const open = state.status !== 'idle' && state.status !== 'choosing';

   return (
      <Dialog
         open={open}
         onOpenChange={(nextOpen) => {
            if (nextOpen) return;

            importer.dismiss();
         }}
      >
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('import.title')}</DialogTitle>
               <DialogDescription>{t('import.description')}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
               {state.status === 'unsupported' ? <p>{t('import.unsupportedTarget')}</p> : null}

               {state.status === 'invalid' ? (
                  <>
                     <p>{t(`import.issues.${issueKeys[state.preview.issue]}`)}</p>
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
                     <Button type="button" size="sm" onClick={() => void importer.choose()}>
                        {t('import.chooseAnother')}
                     </Button>
                  </>
               ) : null}

               {state.status === 'unsupported' || state.status === 'failed' || state.status === 'registered' ? (
                  <Button type="button" size="sm" onClick={importer.dismiss}>
                     {common('close')}
                  </Button>
               ) : null}
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
