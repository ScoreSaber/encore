import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, safeStorage, session, shell } from 'electron';

import { openExternalUrl } from '@/external-navigation';
import { broadcastIpcEvent, registerIpcEventWindow, registerIpcModules } from '@/ipc/main';
import { createTargetIpcModules } from '@/ipc/target-api';
import { defineApiHandlers } from '@/lib/api';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createContentStaging } from '@/lib/content/content-staging';
import { isTrustedRendererNavigation } from '@/lib/security/external-url';
import { createSecretStore } from '@/lib/security/secret-store';
import { createLaunchWatchdog } from '@/main/launch-watchdog';
import { createAppInfo, createAppIpcModule } from '@/modules/app/main/register-ipc';
import { createBSManagerAdoptionService } from '@/modules/bsmanager/main/adoption-service';
import { createBSManagerIpcModule } from '@/modules/bsmanager/main/register-ipc';
import { createBSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import { downloadsApi } from '@/modules/downloads/api';
import { createDownloadService } from '@/modules/downloads/main/download-service';
import { requestMetaAuthToken } from '@/modules/downloads/main/meta-auth-window';
import { createOculusDownloader } from '@/modules/downloads/main/oculus-downloader';
import { createSteamDownloader } from '@/modules/downloads/main/steam-downloader';
import { createVersionCatalog } from '@/modules/downloads/main/version-catalog';
import { installsApi } from '@/modules/installs/api';
import type { InstallDetailRequest } from '@/modules/installs/contract';
import { createInstallImportService } from '@/modules/installs/main/install-import';
import { createInstallManagementService } from '@/modules/installs/main/install-management';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createInstallsIpcModule } from '@/modules/installs/main/register-ipc';
import { launchApi } from '@/modules/launch/api';
import { createLaunchRuntime } from '@/modules/launch/main/launch-runtime';
import { createLaunchService } from '@/modules/launch/main/launch-service';
import { mapsApi } from '@/modules/maps/api';
import { mapLinkSchemes } from '@/modules/maps/contract';
import { createMapService } from '@/modules/maps/main/map-service';
import { createMapsIpcModule } from '@/modules/maps/main/register-ipc';
import { modelsApi } from '@/modules/models/api';
import { modelLinkScheme } from '@/modules/models/contract';
import { createModelService } from '@/modules/models/main/model-service';
import { createModelsIpcModule } from '@/modules/models/main/register-ipc';
import { modsApi } from '@/modules/mods/api';
import { createModCatalogService } from '@/modules/mods/main/mod-catalog';
import { createModService } from '@/modules/mods/main/mod-service';
import { createModUploadService } from '@/modules/mods/main/mod-upload';
import { createModsIpcModule } from '@/modules/mods/main/register-ipc';
import { createModRepositoryService } from '@/modules/mods/main/repo-service';
import { operationsApi } from '@/modules/operations/api';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { playlistsApi } from '@/modules/playlists/api';
import { playlistFileExtension, playlistLinkScheme } from '@/modules/playlists/contract';
import { createPlaylistService } from '@/modules/playlists/main/playlist-service';
import { createPlaylistsIpcModule } from '@/modules/playlists/main/register-ipc';
import { createReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverServer } from '@/modules/receiver/main/receiver-server';
import { createReceiverIpcModule } from '@/modules/receiver/main/register-ipc';
import { createRemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { createRemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import { createSettingsIpcModule } from '@/modules/settings/main/register-ipc';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import { sharedContentApi } from '@/modules/shared-content/api';
import { createSharedContentIpcModule } from '@/modules/shared-content/main/register-ipc';
import { createSharedContentService } from '@/modules/shared-content/main/shared-content-service';
import { encoreProtocol } from '@/modules/shortcuts/contract';
import { registerDeepLinkIntake, setProtocolRegistered } from '@/modules/shortcuts/main/deep-link';
import { createShortcutsIpcModule } from '@/modules/shortcuts/main/register-ipc';
import { createShortcutRuntime } from '@/modules/shortcuts/main/shortcut-runtime';
import { createShortcutService } from '@/modules/shortcuts/main/shortcut-service';
import { supportApi } from '@/modules/support/api';
import { createAppLogWriter, type AppLogWriter } from '@/modules/support/main/app-log';
import { setProblemLogWriter } from '@/modules/support/main/problem-log';
import { createSupportIpcModule } from '@/modules/support/main/register-ipc';
import { createSupportLogService } from '@/modules/support/main/support-logs';
import { createSupportService } from '@/modules/support/main/support-service';
import { detectLocalStores } from '@/modules/targets/main/local-target';
import { createTargetsIpcModule } from '@/modules/targets/main/register-ipc';
import { createTargetRegistry } from '@/modules/targets/main/target-registry';
import { createPostHogTelemetryClient } from '@/modules/telemetry/main/posthog-client';
import { createTelemetryService, describeOperatingSystem } from '@/modules/telemetry/main/telemetry-service';
import { createUpdateIpcModule } from '@/modules/updates/main/register-ipc';
import { initializeAutoUpdates, startDownloadedUpdateInstall } from '@/modules/updates/main/updater';

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const devContentSecurityPolicy = [
   "default-src 'self'",
   "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
   "style-src 'self' 'unsafe-inline'",
   "img-src 'self' data: https:",
   "font-src 'self' data:",
   "connect-src 'self' http://localhost:* ws://localhost:* https:",
   "object-src 'none'",
   "base-uri 'self'",
   "frame-ancestors 'none'"
].join('; ');
const prodContentSecurityPolicy = [
   "default-src 'self'",
   "script-src 'self'",
   "style-src 'self' 'unsafe-inline'",
   "img-src 'self' data: https:",
   "font-src 'self' data:",
   "connect-src 'self'",
   "object-src 'none'",
   "base-uri 'self'",
   "frame-ancestors 'none'"
].join('; ');

let appLogWriter: AppLogWriter | null = null;

function getAppLog() {
   if (!appLogWriter) {
      appLogWriter = createAppLogWriter({
         logsPath: app.getPath('logs'),
         homePath: app.getPath('home')
      });
      setProblemLogWriter(appLogWriter);
   }

   return appLogWriter;
}

function registerIpcHandlers() {
   const dataPath = app.getPath('userData');
   const homePath = app.getPath('home');
   const appVersion = app.getVersion();
   const appLog = getAppLog();
   const operationRegistry = createOperationRegistry();
   const contentStaging = createContentStaging({ dataPath });
   const settingsStore = createSettingsStore({
      dataPath,
      appVersion,
      platform: process.platform,
      arch: process.arch
   });
   const secretStore = createSecretStore({
      dataPath,
      platform: process.platform,
      protection: safeStorage
   });
   const installRegistry = createInstallRegistry({
      dataPath,
      settingsStore,
      detectStores: detectLocalStores
   });
   const postHogApiKey = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim() ?? '';
   const postHogHost = import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';
   const telemetry = postHogApiKey
      ? createPostHogTelemetryClient({ apiKey: postHogApiKey, host: postHogHost }).match({
           ok: (client) =>
              createTelemetryService({
                 dataPath,
                 appVersion,
                 operatingSystem: describeOperatingSystem(process.platform, process.getSystemVersion()),
                 platform: process.platform,
                 settings: settingsStore,
                 installs: installRegistry,
                 client
              }),
           err: (error) => {
              void appLog.warn(`${error.message}: ${error.detail}`);
              return null;
           }
        })
      : null;
   void telemetry?.start();
   const versionCatalog = createVersionCatalog({ dataPath });
   const steamDownloader = createSteamDownloader({
      settingsStore,
      registry: installRegistry,
      operations: operationRegistry,
      catalog: versionCatalog
   });
   const oculusDownloader = createOculusDownloader({
      settingsStore,
      registry: installRegistry,
      operations: operationRegistry,
      catalog: versionCatalog,
      requestToken: requestMetaAuthToken
   });
   const installManagement = createInstallManagementService({
      registry: installRegistry,
      operations: operationRegistry
   });
   const installApi = defineApiHandlers(installsApi, installManagement, { subscribe: installRegistry.subscribe });
   const launchService = createLaunchService({
      settingsStore,
      registry: installRegistry,
      operations: operationRegistry,
      runtime: createLaunchRuntime({ prepareWatchdog: createLaunchWatchdog(dataPath) })
   });
   const downloadService = createDownloadService({ steam: steamDownloader, oculus: oculusDownloader });
   const downloadApi = defineApiHandlers(downloadsApi, downloadService);
   const launchModule = defineApiHandlers(launchApi, launchService);
   const operationApi = defineApiHandlers(operationsApi, operationRegistry, { subscribe: operationRegistry.subscribe });
   const mapService = createMapService({
      registry: installRegistry,
      operations: operationRegistry,
      staging: contentStaging,
      dataPath
   });
   const modelService = createModelService({
      registry: installRegistry,
      operations: operationRegistry,
      staging: contentStaging,
      dataPath
   });
   const mapApi = defineApiHandlers(mapsApi, mapService, { subscribe: mapService.subscribe });
   const modelApi = defineApiHandlers(modelsApi, modelService, { subscribe: modelService.subscribe });
   const playlistService = createPlaylistService({
      registry: installRegistry,
      operations: operationRegistry,
      maps: mapService,
      staging: contentStaging,
      dataPath
   });
   const playlistApi = defineApiHandlers(playlistsApi, playlistService, { subscribe: playlistService.subscribe });
   const sharedContentService = createSharedContentService({
      registry: installRegistry,
      settingsStore,
      operations: operationRegistry
   });
   const sharedContentModule = defineApiHandlers(sharedContentApi, sharedContentService, { subscribe: sharedContentService.subscribe });
   const supportLogs = createSupportLogService({
      logsPath: appLog.logsPath,
      homePath,
      getInstall: (installId) => installRegistry.get(installId),
      getInstalls: async () => (await installRegistry.list()).installs
   });
   const modRepositories = createModRepositoryService({
      dataPath,
      settingsStore
   });
   const modService = createModService({
      registry: installRegistry,
      operations: operationRegistry,
      ingestion: createContentIngestionService({
         dataPath,
         staging: contentStaging
      }),
      dataPath,
      catalog: createModCatalogService({
         dataPath,
         repositories: modRepositories
      })
   });
   const modUploads = createModUploadService({ dataPath, mods: modService });
   const modApi = defineApiHandlers(
      modsApi,
      {
         ...modService,
         syncRepositories: modRepositories.sync,
         prepareImportUpload: modUploads.prepare,
         previewImportUpload: modUploads.preview,
         importUpload: modUploads.importMod,
         discardImportUpload: async ({ uploadId }) => ({ discarded: await modUploads.discard(uploadId) })
      },
      { uploadHandlers: { importFile: modUploads.receive } }
   );
   const installLogApi = defineApiHandlers(supportApi, supportLogs);
   const targetApis = [
      downloadApi,
      launchModule,
      operationApi,
      installApi,
      installLogApi,
      mapApi,
      modelApi,
      modApi,
      playlistApi,
      sharedContentModule
   ];
   const receiver = createReceiverServer({
      settingsStore,
      identityStore: createReceiverIdentityStore({ secretStore }),
      apiModules: targetApis,
      getSecretStoreAvailability: () => secretStore.getAvailability()
   });
   const remoteReceiver = createRemoteReceiverClient({
      store: createRemoteTargetStore({ settingsStore, secretStore }),
      apis: targetApis.map(({ api }) => api)
   });
   const installImports = createInstallImportService({
      settingsStore,
      registry: installRegistry
   });
   const bsmanagerLocations = {
      platform: process.platform,
      homePath,
      documentsPath: app.getPath('documents'),
      appDataPath: app.getPath('appData')
   };
   const bsmanagerAdoption = createBSManagerAdoptionService({
      registry: installRegistry,
      settingsStore,
      converter: createBSManagerSharedContentConverter({
         operations: operationRegistry,
         locations: bsmanagerLocations
      }),
      locations: bsmanagerLocations
   });
   void bsmanagerAdoption.migrateAdoptedSetup();
   const targetRegistry = createTargetRegistry({ remote: remoteReceiver });
   const getInstall = async ({ targetId, installId }: InstallDetailRequest) => {
      const result = await targetRegistry.callTarget(installApi, 'getDetail', targetId, { installId });

      return result.status === 'ok' ? result.value : null;
   };
   const shortcutService = createShortcutService({
      runtime: createShortcutRuntime(),
      getInstall
   });
   const supportService = createSupportService({
      logs: supportLogs,
      installLogs: installLogApi,
      callTarget: targetRegistry.callTarget,
      homePath,
      getAppInfo: createAppInfo
   });

   settingsStore.subscribe((snapshot) => {
      void receiver.reconcile(snapshot);
   });
   void receiver.reconcile();
   void remoteReceiver.restore();
   void contentStaging.purge();
   let teardownStarted = false;
   app.on('before-quit', (event) => {
      if (teardownStarted) return;
      teardownStarted = true;
      event.preventDefault();

      const teardown = operationRegistry.dispose().then(() => contentStaging.dispose());
      installRegistry.dispose();
      mapService.dispose();
      modelService.dispose();
      playlistService.dispose();
      sharedContentService.dispose();
      remoteReceiver.dispose();

      const deadline = new Promise((resolve) => setTimeout(resolve, 3_000));
      void Promise.race([Promise.allSettled([teardown, receiver.stop(), telemetry?.dispose()]), deadline]).then(() => {
         if (startDownloadedUpdateInstall()) return;
         app.quit();
      });
   });

   registerIpcModules([
      createAppIpcModule(),
      createSettingsIpcModule(settingsStore),
      createReceiverIpcModule(receiver, remoteReceiver),
      createTargetsIpcModule(targetRegistry),
      createInstallsIpcModule(installRegistry, installImports),
      ...createTargetIpcModules(targetApis, targetRegistry.callTarget, remoteReceiver.subscribeSnapshots, broadcastIpcEvent),
      createMapsIpcModule(mapService),
      createModelsIpcModule(modelService),
      createModsIpcModule(modService, modRepositories, { api: modApi, targets: targetRegistry }),
      createPlaylistsIpcModule(playlistService),
      createBSManagerIpcModule(bsmanagerAdoption),
      createSharedContentIpcModule(sharedContentService),
      createShortcutsIpcModule({
         shortcuts: shortcutService,
         getInstall
      }),
      createSupportIpcModule(supportService),
      createUpdateIpcModule()
   ]);
}

function configureSecurityHeaders() {
   session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
         responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [is.dev ? devContentSecurityPolicy : prodContentSecurityPolicy]
         }
      });
   });
}

function createMainWindow() {
   const rendererPath = join(currentDir, '../renderer/index.html');
   const rendererUrl = is.dev && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : pathToFileURL(rendererPath).toString();
   const mainWindow = new BrowserWindow({
      width: 1236,
      height: 818,
      minWidth: 980,
      minHeight: 660,
      show: false,
      title: 'Encore',
      backgroundColor: '#09090b',
      autoHideMenuBar: true,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      titleBarOverlay: {
         color: '#00000000',
         symbolColor: '#71717a',
         height: 32
      },
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 9 } : undefined,
      webPreferences: {
         preload: join(currentDir, '../preload/index.cjs'),
         sandbox: true,
         contextIsolation: true,
         nodeIntegration: false,
         webSecurity: true,
         allowRunningInsecureContent: false,
         spellcheck: false
      }
   });
   registerIpcEventWindow(mainWindow);

   mainWindow.once('ready-to-show', () => {
      mainWindow.show();
   });

   mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      handleExternalNavigation(url);
      return { action: 'deny' };
   });

   mainWindow.webContents.on('will-navigate', (event, url) => {
      if (isTrustedRendererNavigation(url, rendererUrl)) return;

      event.preventDefault();
      handleExternalNavigation(url);
   });

   if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
   } else {
      void mainWindow.loadFile(rendererPath);
   }

   return mainWindow;
}

function handleExternalNavigation(url: string) {
   void openExternalUrl(url, (allowedUrl) => shell.openExternal(allowedUrl)).then((result) => {
      if (!result.allowed) void getAppLog().warn(`security: external navigation blocked (${result.reason})`);
   });
}

function startEncore() {
   electronApp.setAppUserModelId('com.scoresaber.encore');
   configureSecurityHeaders();
   session.defaultSession.on('will-download', (event) => event.preventDefault());
   setProtocolRegistered(encoreProtocol, true);
   registerIpcHandlers();
   initializeAutoUpdates();
   void getAppLog().info(`app started ${app.getVersion()} on ${process.platform} ${process.arch} (electron ${process.versions.electron})`);

   app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
   });

   app.on('web-contents-created', (_, contents) => {
      contents.on('will-attach-webview', (event) => {
         event.preventDefault();
      });
   });

   createMainWindow();

   app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
         createMainWindow();
      }
   });
}

if (app.requestSingleInstanceLock()) {
   registerDeepLinkIntake([encoreProtocol, ...mapLinkSchemes, modelLinkScheme, playlistLinkScheme], [playlistFileExtension]);
   void app.whenReady().then(startEncore);
} else {
   app.quit();
}

if (process.platform === 'linux') {
   process.on('SIGTERM', () => app.quit());
}

app.on('window-all-closed', () => {
   if (process.platform !== 'darwin') {
      app.quit();
   }
});
