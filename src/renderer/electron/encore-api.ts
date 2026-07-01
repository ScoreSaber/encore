import type { AppInfo, EncoreApi } from '@/shared/ipc/contracts';

const browserFallbackInfo: AppInfo = {
   name: 'Encore',
   version: '0.0.1',
   release: {
      channel: 'alpha',
      version: '0.0.1',
      label: 'alpha@0.0.1',
      source: 'release'
   },
   platform: 'browser',
   arch: 'browser',
   electron: 'browser',
   chrome: navigator.userAgent,
   node: 'browser'
};

const browserFallbackApi = {
   platform: 'browser',
   app: {
      getInfo: () => Promise.resolve(browserFallbackInfo)
   }
} satisfies EncoreApi;

export function getEncoreApi() {
   return window.encore ?? browserFallbackApi;
}
