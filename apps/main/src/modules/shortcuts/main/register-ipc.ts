import { broadcastIpcEvent, defineIpcHandlers } from '@/ipc/main';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import type { InstallDetailRequest } from '@/modules/installs/contract';
import { modRepositoryLinkAction, parseModRepositoryLink } from '@/modules/mods/contract';
import { queueRepositoryLink } from '@/modules/mods/main/repository-link-intake';
import { encoreProtocol, type LaunchLinkEvent } from '@/modules/shortcuts/contract';
import { shortcutsIpc } from '@/modules/shortcuts/ipc';
import { onDeepLink } from '@/modules/shortcuts/main/deep-link';
import { resolveLaunchLink } from '@/modules/shortcuts/main/launch-link-intake';
import type { ShortcutService } from '@/modules/shortcuts/main/shortcut-service';

export function createShortcutsIpcModule(options: {
   shortcuts: ShortcutService;
   getInstall: (request: InstallDetailRequest) => Promise<{ name: string } | null>;
}) {
   const links = createPendingIpcEvent<LaunchLinkEvent>((event) => broadcastIpcEvent(shortcutsIpc.onLinkOpened, event));

   onDeepLink([encoreProtocol], async (link) => {
      if (new URL(link).host === modRepositoryLinkAction) {
         queueRepositoryLink(parseModRepositoryLink(link));
         return;
      }

      links.publish(await resolveLaunchLink(link, options.getInstall));
   });

   return defineIpcHandlers(shortcutsIpc, {
      getState: () => options.shortcuts.getState(),
      preview: (_event, request) => options.shortcuts.preview(request),
      create: (_event, request) => options.shortcuts.create(request),
      setProtocolRegistered: (_event, request) => options.shortcuts.setProtocolRegistered(request.registered),
      takePendingLink: () => links.take()
   });
}
