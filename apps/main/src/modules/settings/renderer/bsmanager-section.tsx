import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

import { BSManagerDialog } from '@/modules/bsmanager/renderer/bsmanager-dialog';
import { useBSManagerAdoption } from '@/modules/bsmanager/renderer/use-bsmanager-adoption';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/settings-provider';
import { localTargetId } from '@/modules/targets/contract';

export function BSManagerSection() {
   const t = useTranslations('bsmanager');
   const settings = useSettings();
   const adopter = useBSManagerAdoption(localTargetId);
   const detection = adopter.detection;
   const busy = adopter.state.status === 'loading' || adopter.state.status === 'adopting';
   const dismissed = settings.snapshot?.app.bsmanagerPromptDismissed ?? false;

   if (detection?.status !== 'detected' || !detection.rootPath) return null;

   return (
      <SettingsSection title={t('settings.title')}>
         <SettingsRow label={t('settings.source')} description={detection.rootPath}>
            <Button type="button" size="sm" disabled={busy} onClick={() => void adopter.open()}>
               {t('settings.review')}
            </Button>
         </SettingsRow>

         {dismissed ? (
            <SettingsRow label={t('settings.prompt')}>
               <Button type="button" variant="outline" size="sm" onClick={() => void settings.updateApp({ bsmanagerPromptDismissed: false })}>
                  {t('settings.showPrompt')}
               </Button>
            </SettingsRow>
         ) : null}

         <BSManagerDialog adopter={adopter} />
      </SettingsSection>
   );
}
