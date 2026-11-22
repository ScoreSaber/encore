import { defineIpcHandlers, type IpcBroadcast } from '@/ipc/host';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import { createLatestGuard } from '@/lib/state/machine';
import { installsApi } from '@/modules/installs/api';
import type { InstallDetailRequest } from '@/modules/installs/contract';
import { launchApi } from '@/modules/launch/api';
import { modRepositoryLinkAction } from '@/modules/mods/contract';
import { encoreProtocol, type LaunchLinkEvent } from '@/modules/shortcuts/contract';
import { shortcutsIpc } from '@/modules/shortcuts/ipc';
import { onDeepLink } from '@/modules/shortcuts/main/deep-link';
import { resolveLaunchLink } from '@/modules/shortcuts/main/launch-link-intake';
import { createShortcutRuntime } from '@/modules/shortcuts/main/shortcut-runtime';
import { createShortcutService } from '@/modules/shortcuts/main/shortcut-service';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

export function createShortcutsIpcModule(
   callTarget: TargetRegistry['callTarget'],
   broadcast: IpcBroadcast,
   onRepositoryLink: (link: string) => void
) {
   const getInstall = async ({ targetId, installId }: InstallDetailRequest) => {
      const result = await callTarget(installsApi, 'getDetail', targetId, { installId });
      return result.status === 'ok' ? result.value : null;
   };
   const getLaunchEnvironment = async ({ targetId, installId }: InstallDetailRequest) => {
      const result = await callTarget(launchApi, 'getOptions', targetId, { installId });
      return result.status === 'ok' ? result.value.environment : {};
   };
   const shortcuts = createShortcutService({ runtime: createShortcutRuntime(), getInstall });
   const links = createPendingIpcEvent<LaunchLinkEvent>((event) => broadcast(shortcutsIpc.onLinkOpened, event));
   const resolveGuard = createLatestGuard();

   onDeepLink([encoreProtocol], async (link) => {
      if (new URL(link).host === modRepositoryLinkAction) {
         onRepositoryLink(link);
         return;
      }

      const token = resolveGuard.next();
      const resolved = await resolveLaunchLink(link, getInstall, getLaunchEnvironment);
      if (resolveGuard.isCurrent(token)) links.publish(resolved);
   });

   return defineIpcHandlers(shortcutsIpc, {
      getState: () => shortcuts.getState(),
      preview: (request) => shortcuts.preview(request),
      create: (request) => shortcuts.create(request),
      setProtocolRegistered: (request) => shortcuts.setProtocolRegistered(request.registered),
      takePendingLink: () => links.take()
   });
}
