import { createFileRoute } from '@tanstack/react-router';

import { AppearanceSection } from '@/modules/settings/renderer/appearance-section';
import { useSettings } from '@/modules/settings/renderer/use-settings';

export const Route = createFileRoute('/settings/appearance')({
   component: AppearanceSettings
});

function AppearanceSettings() {
   const settings = useSettings();

   return <AppearanceSection disabled={settings.saving} />;
}
