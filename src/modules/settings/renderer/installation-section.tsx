import { useTranslations } from 'use-intl';

import { InstallRootField } from '@/modules/installs/renderer/install-root-field';
import { SettingsSection } from '@/modules/settings/renderer/settings-layout';

export function InstallationSection({ disabled }: { disabled: boolean }) {
   const t = useTranslations('settings.installation');

   return (
      <SettingsSection title={t('title')}>
         <InstallRootField disabled={disabled} />
      </SettingsSection>
   );
}
