import { openLocalPath } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/host';
import { installsIpc } from '@/modules/installs/ipc';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';

export function createInstallsIpcModule(installs: InstallRegistry) {
   return defineIpcHandlers(installsIpc, {
      openFolder: (request) => openLocalPath(request.targetId, async () => (await installs.get(request.installId))?.path ?? null)
   });
}
