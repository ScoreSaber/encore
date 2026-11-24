import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { RemoteSection } from '@/modules/receiver/renderer/remote-section';
import { useSettings } from '@/modules/settings/renderer/use-settings';
import { useSelectedTarget } from '@/modules/targets/renderer/use-selected-target';

export const Route = createFileRoute('/settings/remote')({
   validateSearch: z.object({ add: z.boolean().optional().catch(undefined) }),
   component: RemoteSettings
});

function RemoteSettings() {
   const settings = useSettings();
   const { add } = Route.useSearch();
   const targetList = useSelectedTarget();
   const { targets } = targetList;
   const receiverSettings = settings.snapshot?.app.receiver;

   if (!receiverSettings) return null;

   return (
      <RemoteSection
         receiverSettings={receiverSettings}
         startAdding={add ?? false}
         disabled={settings.saving}
         canShareThisComputer={targets.some(
            (target) => target.kind === (window.encore.runtime === 'mobile' ? 'quest' : 'local') && target.capabilities.includes('list-installs')
         )}
         remoteTargets={targets.filter((target) => target.kind === 'remote')}
         targetsStatus={targetList.status}
         onReloadTargets={targetList.reload}
         onRemotePaired={targetList.selectTarget}
      />
   );
}
