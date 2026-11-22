import { createFileRoute } from '@tanstack/react-router';

import { ModRepositoriesFields } from '@/modules/settings/renderer/mod-repositories-section';

export const Route = createFileRoute('/settings/mods')({
   component: ModRepositoriesFields
});
