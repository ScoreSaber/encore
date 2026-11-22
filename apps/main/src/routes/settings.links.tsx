import { createFileRoute } from '@tanstack/react-router';

import { DeepLinkSection } from '@/modules/settings/renderer/deep-link-section';
import { useSettings } from '@/modules/settings/renderer/use-settings';

export const Route = createFileRoute('/settings/links')({
   component: LinkSettings
});

function LinkSettings() {
   const settings = useSettings();

   return <DeepLinkSection disabled={settings.saving} />;
}
