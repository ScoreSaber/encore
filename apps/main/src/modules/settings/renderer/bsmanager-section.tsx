import { useTranslations } from 'use-intl';

import { Button } from '@/components/ui/button';

import { BSManagerDialog } from '@/modules/bsmanager/renderer/bsmanager-dialog';
import { useBSManagerAdoption } from '@/modules/bsmanager/renderer/use-bsmanager-adoption';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { localTargetId } from '@/modules/targets/contract';

export function BSManagerSection() {
   const t = useTranslations('bsmanager');
   const adopter = useBSManagerAdoption(localTargetId);
   const detection = adopter.detection;
   const busy = adopter.state.status === 'loading' || adopter.state.status === 'adopting';

   if (detection?.status !== 'detected' || !detection.rootPath) return null;

   return (
      <SettingsSection title={t('settings.title')}>
         <SettingsRow
            title={t('settings.source')}
            description={<span className="break-all">{detection.rootPath}</span>}
            control={
               <Button type="button" size="sm" disabled={busy} onClick={() => void adopter.open()}>
                  {t('settings.review')}
               </Button>
            }
         />

         <BSManagerDialog adopter={adopter} />
      </SettingsSection>
   );
}
