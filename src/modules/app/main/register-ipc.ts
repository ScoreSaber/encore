import { app, clipboard } from 'electron';

import { defineIpcHandlers } from '@/app/ipc/main';
import { createAppPackaging } from '@/app/packaging';
import type { AppInfo } from '@/modules/app/contract';
import { appIpc } from '@/modules/app/ipc';
import { getEncoreReleaseInfo } from '@/modules/app/main/version';

export function createAppIpcModule() {
   const appInfo = createAppInfo();

   return defineIpcHandlers(appIpc, {
      copyText: (_event, request) => clipboard.writeText(request.text),
      getInfo: () => appInfo,
      quit: () => app.quit()
   });
}

export function createAppInfo(): AppInfo {
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
      packaging: createAppPackaging({ packaged: app.isPackaged, platform: process.platform, env: process.env }),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
   };
}
