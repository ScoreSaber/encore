import { app } from 'electron';

import { defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import { getEncoreReleaseInfo } from '@/main/version';
import { appInfoQuery, appIpcModule, type AppInfo } from '@/shared/ipc/modules/app';

export function createAppIpcModule() {
   const appInfo = createAppInfo();

   return defineIpcMainModule(appIpcModule, [defineIpcMainQuery(appInfoQuery, () => appInfo)]);
}

function createAppInfo(): AppInfo {
   const appVersion = app.getVersion();
   const release = getEncoreReleaseInfo({
      appVersion,
      isPackaged: app.isPackaged,
      cwd: process.cwd()
   });

   return {
      name: app.getName(),
      version: appVersion,
      release,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
   };
}
