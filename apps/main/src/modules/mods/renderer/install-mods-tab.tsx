import { useInstalls } from '@/modules/installs/renderer/use-installs';
import type { TargetModRequest } from '@/modules/mods/api';
import { InstallModsPanel } from '@/modules/mods/renderer/install-mods-panel';
import { ModActionDialog } from '@/modules/mods/renderer/mod-action-dialog';
import { useInstallMods } from '@/modules/mods/renderer/use-install-mods';

export function InstallModsTab({ request, active }: { request: TargetModRequest; active: boolean }) {
   const mods = useInstallMods(request);
   const installs = useInstalls(request.targetId);
   const otherInstalls = installs.snapshot?.installs.filter((install) => install.id !== request.installId) ?? [];

   return (
      <>
         {active ? <InstallModsPanel mods={mods} targetId={request.targetId} otherInstalls={otherInstalls} /> : null}
         <ModActionDialog request={request} mods={mods} />
      </>
   );
}
