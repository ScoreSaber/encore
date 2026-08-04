import { useTranslations } from 'use-intl';

import { Switch } from '@/components/ui/switch';

import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/settings-provider';

export function AdvancedSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.advanced');
   const settings = useSettings();

   if (settings.snapshot?.diagnostics.platform !== 'win32') return null;

   return (
      <SettingsSection title={t('title')}>
         <SettingsRow label={t('useSymlinks.title')} description={t('useSymlinks.description')} htmlFor="settings-use-symlinks">
            <Switch
               id="settings-use-symlinks"
               checked={settings.snapshot.library.useSymlinks}
               disabled={disabled}
               onCheckedChange={(useSymlinks) => void settings.updateLibrary({ useSymlinks })}
            />
         </SettingsRow>
      </SettingsSection>
   );
}
