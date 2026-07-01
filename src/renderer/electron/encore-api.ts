import type { EncoreApi } from '@/shared/ipc/api';
import type { AppInfo } from '@/shared/ipc/modules/app';
import type { UpdateSnapshot } from '@/shared/ipc/modules/update';
import type { OperationCancelResult, OperationDemoStartResult } from '@/shared/operations';
import {
   createDefaultAppSettings,
   createDefaultLibrarySettings,
   type AppSettingsPatch,
   type LibrarySettingsPatch,
   type SettingsSnapshot
} from '@/shared/settings';

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
let browserFallbackSettings = createBrowserFallbackSettings();

const browserFallbackApi = {
   platform: 'browser',
   app: {
      getInfo: () => Promise.resolve(browserFallbackInfo)
   },
   settings: {
      getSnapshot: () => Promise.resolve(browserFallbackSettings),
      updateApp: (patch) => {
         const app = applyBrowserAppPatch(browserFallbackSettings.app, patch);
         browserFallbackSettings = {
            ...browserFallbackSettings,
            app,
            diagnostics: {
               ...browserFallbackSettings.diagnostics,
               receiverEnabled: app.receiver.enabled
            }
         };

         return Promise.resolve({
            ok: true,
            value: browserFallbackSettings
         });
      },
      updateLibrary: (patch) => {
         const library = applyBrowserLibraryPatch(browserFallbackSettings.library, patch);
         browserFallbackSettings = {
            ...browserFallbackSettings,
            library,
            diagnostics: {
               ...browserFallbackSettings.diagnostics,
               installRoot: library.installRoot
            }
         };

         return Promise.resolve({
            ok: true,
            value: browserFallbackSettings
         });
      }
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

function createBrowserFallbackSettings(): SettingsSnapshot {
   const app = createDefaultAppSettings();
   const library = createDefaultLibrarySettings('browser-library');

   return {
      status: 'ready',
      app,
      library,
      diagnostics: {
         platform: 'browser',
         arch: 'browser',
         appVersion: __ENCORE_VERSION__,
         dataPath: 'browser',
         settingsPath: 'browser',
         installRoot: library.installRoot,
         receiverEnabled: app.receiver.enabled
      }
   };
}

function applyBrowserAppPatch(app: SettingsSnapshot['app'], patch: AppSettingsPatch): SettingsSnapshot['app'] {
   return {
      theme: patch.theme ?? app.theme,
      locale: patch.locale ?? app.locale,
      receiver: {
         enabled: patch.receiver?.enabled ?? app.receiver.enabled,
         pairedDevices: patch.receiver?.pairedDevices ?? app.receiver.pairedDevices
      }
   };
}

function applyBrowserLibraryPatch(library: SettingsSnapshot['library'], patch: LibrarySettingsPatch) {
   return {
      installRoot: patch.installRoot ?? library.installRoot,
      defaultStore: patch.defaultStore === undefined ? library.defaultStore : patch.defaultStore,
      protonPath: patch.protonPath === undefined ? library.protonPath : patch.protonPath
   };
}
