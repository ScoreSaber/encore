import { app, clipboard, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';

import { showOpenDialog } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/host';
import { evaluateHttpsUrl, openUrl } from '@/lib/security/external-url';
import type { AppInfo, PathChoice, PathChoiceRequest } from '@/modules/app/contract';
import { appIpc } from '@/modules/app/ipc';
import { getEncoreReleaseInfo } from '@/modules/app/main/version';
import { createAppPackaging } from '@/packaging';

export function createAppIpcModule(options: { trayHost: Promise<boolean> }) {
   const appInfo = createAppInfo();

   return defineIpcHandlers<typeof appIpc, IpcMainInvokeEvent>(appIpc, {
      choosePath: (request, event) => choosePath(event, request),
      hasTray: () => options.trayHost,
      copyText: (request) => clipboard.writeText(request.text),
      getInfo: () => appInfo,
      openLink: async (request) => {
         const decision = await openUrl(evaluateHttpsUrl(request.url), (url) => shell.openExternal(url));

         return { status: decision.allowed ? 'opened' : 'blocked' };
      },
      quit: () => {
         app.quit();
         return undefined;
      }
   });
}

async function choosePath(event: IpcMainInvokeEvent, request: PathChoiceRequest): Promise<PathChoice> {
   const options: OpenDialogOptions = { properties: request.kind === 'folder' ? ['openDirectory', 'createDirectory'] : ['openFile'] };
   if (request.title) options.title = request.title;
   if (request.defaultPath) options.defaultPath = request.defaultPath;
   if (request.extensions) options.filters = [{ name: request.title ?? 'Files', extensions: request.extensions }];
   const picked = await showOpenDialog(event, options);
   const path = picked.filePaths[0];

   return picked.canceled || !path ? { status: 'cancelled' } : { status: 'selected', path };
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
