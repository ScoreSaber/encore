import { defineIpcMainCommand, defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import { checkForUpdates, getUpdateSnapshot, installDownloadedUpdate } from '@/main/updater';
import { updateCheckCommand, updateInfoQuery, updateInstallCommand, updateIpcModule } from '@/shared/ipc/modules/update';

export function createUpdateIpcModule() {
   return defineIpcMainModule(updateIpcModule, [
      defineIpcMainQuery(updateInfoQuery, () => getUpdateSnapshot()),
      defineIpcMainCommand(updateCheckCommand, () => checkForUpdates()),
      defineIpcMainCommand(updateInstallCommand, () => installDownloadedUpdate())
   ]);
}
