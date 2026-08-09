import { defineIpcHandlers } from '@/ipc/main';
import { updatesIpc } from '@/modules/updates/ipc';
import { checkForUpdates, getUpdateSnapshot, installDownloadedUpdate } from '@/modules/updates/main/updater';

export function createUpdateIpcModule() {
   return defineIpcHandlers(updatesIpc, {
      getSnapshot: () => getUpdateSnapshot(),
      checkForUpdates: () => checkForUpdates(),
      installDownloaded: () => installDownloadedUpdate()
   });
}
