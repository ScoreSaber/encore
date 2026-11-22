import { createFileRoute } from '@tanstack/react-router';

import { QuestStandaloneSection } from '@/modules/quest/renderer/quest-standalone-section';

export const Route = createFileRoute('/settings/quest')({
   component: QuestStandaloneSection
});
