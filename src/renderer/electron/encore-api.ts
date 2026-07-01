import type { AppInfo, EncoreApi, UpdateSnapshot } from '@/shared/ipc/contracts';

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

const browserFallbackApi = {
   platform: 'browser',
   app: {
      getInfo: () => Promise.resolve(browserFallbackInfo),
      getUpdate: () => Promise.resolve(browserFallbackUpdate),
      checkForUpdates: () => Promise.resolve(browserFallbackUpdate),
      installUpdate: () => Promise.resolve(browserFallbackUpdate),
      onUpdateStatus: () => () => {}
   }
} satisfies EncoreApi;

export function getEncoreApi() {
   return window.encore ?? browserFallbackApi;
}
