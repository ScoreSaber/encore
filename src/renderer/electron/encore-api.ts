import type { EncoreApi } from '@/shared/ipc/api';
import type { AppInfo } from '@/shared/ipc/modules/app';
import type { UpdateSnapshot } from '@/shared/ipc/modules/update';
import type { OperationCancelResult, OperationDemoStartResult } from '@/shared/operations';

const browserFallbackInfo: AppInfo = {
   name: 'Encore',
   version: __ENCORE_VERSION__,
   release: {
      channel: 'alpha',
      version: __ENCORE_VERSION__,
      label: `alpha@${__ENCORE_VERSION__}`,
      source: 'fallback'
   },
   platform: 'browser',
   arch: 'browser',
   electron: 'browser',
   chrome: navigator.userAgent,
   node: 'browser'
};
const browserFallbackUpdate: UpdateSnapshot = {
   status: 'disabled',
   message: 'updates run in packaged builds'
};
const browserFallbackCancel: OperationCancelResult = {
   ok: true,
   status: 'noop',
   reason: 'not-found',
   id: 'browser'
};
const browserFallbackDemoStart: OperationDemoStartResult = {
   ok: false,
   error: {
      code: 'operations.demo.unavailable',
      message: 'demo operations run in Electron development builds'
   }
};

const browserFallbackApi = {
   platform: 'browser',
   app: {
      getInfo: () => Promise.resolve(browserFallbackInfo)
   },
   update: {
      getSnapshot: () => Promise.resolve(browserFallbackUpdate),
      checkForUpdates: () => Promise.resolve(browserFallbackUpdate),
      installDownloaded: () => Promise.resolve(browserFallbackUpdate),
      onStatus: () => () => {}
   },
   operations: {
      list: () => Promise.resolve([]),
      cancel: () => Promise.resolve(browserFallbackCancel),
      startDemo: () => Promise.resolve(browserFallbackDemoStart),
      onSnapshot: () => () => {}
   }
} satisfies EncoreApi;

export function getEncoreApi() {
   return window.encore ?? browserFallbackApi;
}
