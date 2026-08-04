import { useTranslations } from 'use-intl';

import alarmaUrl from './alarma.webp';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { useSettings } from '@/modules/settings/renderer/settings-provider';

export function AlphaWarningDialog() {
   const t = useTranslations('app.alphaWarning');
   const settings = useSettings();
   const open = settings.snapshot !== null && !settings.snapshot.app.alphaWarningAccepted;
   const busy = settings.saveStatus === 'saving';

   return (
      <Dialog open={open} onOpenChange={() => undefined}>
         <DialogContent
            showCloseButton={false}
            onEscapeKeyDown={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => event.preventDefault()}
         >
            <DialogHeader className="items-center text-center sm:text-center">
               <DialogTitle className="flex items-center gap-2">
                  <img src={alarmaUrl} alt="" aria-hidden="true" draggable={false} className="size-7 rounded-sm" />
                  {t('title')}
                  <img src={alarmaUrl} alt="" aria-hidden="true" draggable={false} className="size-7 rounded-sm" />
               </DialogTitle>
               <DialogDescription className="not-sr-only text-sm leading-normal whitespace-pre-line">{t('body')}</DialogDescription>
            </DialogHeader>

            <DialogFooter className="w-full flex-row justify-between sm:justify-between">
               <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void window.encore.app.quit()}>
                  {t('quit')}
               </Button>
               <Button type="button" size="sm" disabled={busy} onClick={() => void settings.updateApp({ alphaWarningAccepted: true })}>
                  {t('accept')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
