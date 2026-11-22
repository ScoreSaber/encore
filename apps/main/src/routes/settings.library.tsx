import { createFileRoute } from '@tanstack/react-router';
import { useTranslations } from 'use-intl';

import { InstallRootField } from '@/modules/installs/renderer/install-root-field';
import { AdvancedSection } from '@/modules/settings/renderer/advanced-section';
import { BSManagerSection } from '@/modules/settings/renderer/bsmanager-section';
import { SettingsSection } from '@/modules/settings/renderer/settings-layout';
import { useSettings } from '@/modules/settings/renderer/use-settings';

export const Route = createFileRoute('/settings/library')({
   component: LibrarySettings
});

function LibrarySettings() {
   const t = useTranslations('settings');
   const settings = useSettings();

   return (
      <>
         <SettingsSection title={t('installation.title')}>
            <InstallRootField disabled={settings.saving} />
         </SettingsSection>
         <BSManagerSection />
         <AdvancedSection disabled={settings.saving} />
      </>
   );
}
