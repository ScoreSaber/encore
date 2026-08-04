import { PackageOpen } from 'lucide-react';
import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';

import { BSManagerDialog } from '@/modules/bsmanager/renderer/bsmanager-dialog';
import { useBSManagerAdoption } from '@/modules/bsmanager/renderer/use-bsmanager-adoption';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { localTargetId } from '@/modules/targets/contract';

export function BSManagerPrompt({ installCount }: { installCount: number }) {
   const t = useTranslations('bsmanager');
   const settings = useSettings();
   const adopter = useBSManagerAdoption(localTargetId);
   const detection = adopter.detection;
   const dismissed = settings.snapshot?.app.bsmanagerPromptDismissed ?? true;
   const visible = !dismissed && installCount === 0 && detection?.status === 'detected';

   return (
      <>
         {visible ? (
            <section className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
               <PackageOpen className="text-primary size-5 shrink-0" />
               <div className="min-w-0 flex-1">
                  <h2 className="font-medium">{t('prompt.title')}</h2>
                  <p className="text-muted-foreground text-sm">{t('prompt.description', { path: detection.rootPath ?? '' })}</p>
               </div>
               <ButtonGroup className="shrink-0" aria-label={t('prompt.title')}>
                  <Button type="button" size="sm" onClick={() => void adopter.open()}>
                     {t('prompt.review')}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => void settings.updateApp({ bsmanagerPromptDismissed: true })}>
                     {t('prompt.dismiss')}
                  </Button>
               </ButtonGroup>
            </section>
         ) : null}

         <BSManagerDialog adopter={adopter} />
      </>
   );
}
