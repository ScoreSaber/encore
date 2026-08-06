import { useTranslations } from 'use-intl';

import { Switch } from '@/components/ui/switch';

import { ProtonFolderField } from '@/modules/launch/renderer/proton-folder-field';
import { SettingsRow, SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/settings-provider';

export function AdvancedSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.advanced');
   const settings = useSettings();

   const snapshot = settings.snapshot;
   if (!snapshot) return null;

   if (snapshot.diagnostics.platform === 'linux') {
      return (
         <SettingsSection title={t('title')}>
            <ProtonFolderField disabled={disabled} />
         </SettingsSection>
      );
   }

   if (snapshot.diagnostics.platform !== 'win32') return null;

   return (
      <SettingsSection title={t('title')}>
         <SettingsRow label={t('useSymlinks.title')} description={t('useSymlinks.description')} htmlFor="settings-use-symlinks">
            <Switch
               id="settings-use-symlinks"
               checked={snapshot.library.useSymlinks}
               disabled={disabled}
               onCheckedChange={(useSymlinks) => void settings.updateLibrary({ useSymlinks })}
            />
         </SettingsRow>
      </SettingsSection>
   );
}
