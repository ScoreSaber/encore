import { useTranslations } from 'use-intl';

import { Switch } from '@/components/ui/switch';

import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/settings-provider';

export function TelemetrySection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.telemetry');
   const settings = useSettings();
   const snapshot = settings.snapshot;
   if (!snapshot) return null;

   return (
      <SettingsSection title={t('title')}>
         <SettingsRow
            label={t('share.title')}
            description={
               <>
                  {t('description')}{' '}
                  <a
                     className="text-foreground underline underline-offset-2"
                     href="https://encore.scoresaber.com/privacy"
                     target="_blank"
                     rel="noreferrer"
                  >
                     {t('disclosure')}
                  </a>
               </>
            }
            htmlFor="settings-telemetry-enabled"
         >
            <Switch
               id="settings-telemetry-enabled"
               checked={snapshot.app.telemetryEnabled}
               disabled={disabled}
               onCheckedChange={(telemetryEnabled) => void settings.updateApp({ telemetryEnabled })}
            />
         </SettingsRow>
      </SettingsSection>
   );
}
