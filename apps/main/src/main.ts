import { electronApp } from '@electron-toolkit/utils';
import { Result } from 'better-result';
import { app, dialog, safeStorage } from 'electron';

import { broadcastIpcEvent, registerIpcModules } from '@/ipc/main';
import { createPendingIpcEvent } from '@/ipc/pending-event';
import { createAdbProvisioner } from '@/lib/android/adb-provisioner';
import { implementApi } from '@/lib/api';
import { createContentIngestionService } from '@/lib/content/content-ingestion';
import { createContentStaging } from '@/lib/content/content-staging';
import { causeMessage } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { isSteamFrame } from '@/lib/platform/steam-frame';
import { createSecretStore } from '@/lib/security/secret-store';
import { createSerialQueue } from '@/lib/state/machine';
import { createAppTray } from '@/modules/app/main/app-tray';
import { backgroundLaunchFlag, createLoginItem, trayHostAvailable } from '@/modules/app/main/background';
import { minimizeMainWindow, openMainWindow, setMainWindowCloseBehaviour, showMainWindow } from '@/modules/app/main/main-window';
import { createAppInfo, createAppIpcModule } from '@/modules/app/main/register-ipc';
import { createArm64Launch } from '@/modules/arm64/main/arm64-launch';
import { bsmanagerApi } from '@/modules/bsmanager/api';
import { createBSManagerAdoptionService } from '@/modules/bsmanager/main/adoption-service';
import { createBSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import { downloadsApi } from '@/modules/downloads/api';
import { createLocalDownloads } from '@/modules/downloads/main/local-downloads';
import { filesApi } from '@/modules/files/api';
import { createFileBrowser } from '@/modules/files/main/file-browser';
import { installMirrorApi } from '@/modules/install-mirror/api';
import { createMirrorService, mirrorRemoteFrom } from '@/modules/install-mirror/main/mirror-service';
import { beatSaberAppDataPath, createMirrorSource } from '@/modules/install-mirror/main/mirror-source';
import { installsApi } from '@/modules/installs/api';
import { createInstallImportService } from '@/modules/installs/main/install-import';
import { createInstallManagementService } from '@/modules/installs/main/install-management';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createInstallsIpcModule } from '@/modules/installs/main/register-ipc';
import { launchApi } from '@/modules/launch/api';
import { createLaunchRuntime } from '@/modules/launch/main/launch-runtime';
import { createLaunchService } from '@/modules/launch/main/launch-service';
import { createLaunchWatchdog } from '@/modules/launch/main/launch-watchdog';
import { ensureSteamProton } from '@/modules/launch/main/proton';
import { mapsApi, mapSyncApi } from '@/modules/maps/api';
import { mapLinkSchemes } from '@/modules/maps/contract';
import { createMapService } from '@/modules/maps/main/map-service';
import { createMapSyncService } from '@/modules/maps/main/map-sync';
import { createMapsIpcModule } from '@/modules/maps/main/register-ipc';
import { modelsApi } from '@/modules/models/api';
import { modelLinkScheme } from '@/modules/models/contract';
import { createModelService } from '@/modules/models/main/model-service';
import { createModelsIpcModule } from '@/modules/models/main/register-ipc';
import { modsApi } from '@/modules/mods/api';
import { parseModRepositoryLink, type ModRepositoryLinkEvent } from '@/modules/mods/contract';
import { modsIpc } from '@/modules/mods/ipc';
import { createModCatalogService } from '@/modules/mods/main/mod-catalog';
import { createModPatcher } from '@/modules/mods/main/mod-patcher';
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
import { createQuestDeviceService } from '@/modules/quest/main/quest-device-service';
import { createQuestHeadsets } from '@/modules/quest/main/quest-headsets';
import { createQuestModService } from '@/modules/quest/main/quest-mod-service';
import { createQuestMutationLock } from '@/modules/quest/main/quest-mutation-lock';
import { createQuestPatchService } from '@/modules/quest/main/quest-patch-service';
import { createQuestTarget } from '@/modules/quest/main/quest-target';
import { createQuestIpcModule } from '@/modules/quest/main/register-ipc';
import { createReceiverIdentityStore } from '@/modules/receiver/main/receiver-identity';
import { createReceiverServer } from '@/modules/receiver/main/receiver-server';
import { createReceiverIpcModule } from '@/modules/receiver/main/register-ipc';
import { createRemoteReceiverClient } from '@/modules/receiver/main/remote-receiver-client';
import { createRemoteTargetStore } from '@/modules/receiver/main/remote-receiver-store';
import type { SettingsSnapshot } from '@/modules/settings/contract';
import { createSettingsIpcModule } from '@/modules/settings/main/register-ipc';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import { sharedContentApi } from '@/modules/shared-content/api';
import { createSharedContentIpcModule } from '@/modules/shared-content/main/register-ipc';
import { createSharedContentService } from '@/modules/shared-content/main/shared-content-service';
import { defaultSharedContentRootPath } from '@/modules/shared-content/main/shared-paths';
import { encoreProtocol } from '@/modules/shortcuts/contract';
import { registerDeepLinkIntake, setProtocolRegistered } from '@/modules/shortcuts/main/deep-link';
import { createShortcutsIpcModule } from '@/modules/shortcuts/main/register-ipc';
import { openSteamLink, readSteamClientState } from '@/modules/stores/main/steam-client';
import { supportApi } from '@/modules/support/api';
import { createAppLogWriter, type AppLogWriter } from '@/modules/support/main/app-log';
import { createSupportIpcModule } from '@/modules/support/main/register-ipc';
import { createSupportLogService } from '@/modules/support/main/support-logs';
import { createSupportService } from '@/modules/support/main/support-service';
import { detectLocalStores } from '@/modules/targets/main/local-target';
import { createTargetsIpcModule } from '@/modules/targets/main/register-ipc';
import { createTargetRegistry } from '@/modules/targets/main/target-registry';
import { startTelemetry } from '@/modules/telemetry/main/start-telemetry';
import { updatesApi } from '@/modules/updates/api';
import { createUpdater, loadElectronUpdater } from '@/modules/updates/main/updater';
import { createAppPackaging } from '@/packaging';

import { join } from 'node:path';

function composeEncore(log: AppLogWriter) {
   const dataPath = app.getPath('userData');
   const homePath = app.getPath('home');
   const appVersion = app.getVersion();
   const teardown: (() => Promise<void> | void)[] = [];
   const disposeOnQuit = <Service extends { dispose: () => Promise<void> | void }>(service: Service) => {
      teardown.push(service.dispose);
      return service;
   };

   const operationRegistry = createOperationRegistry();
   const contentStaging = createContentStaging({ dataPath });
   teardown.push(() => operationRegistry.dispose().then(contentStaging.dispose));
   const settingsStore = createSettingsStore({
      dataPath,
      appVersion,
      platform: process.platform,
      arch: process.arch
   });
   if (isSteamFrame()) safeStorage.setUsePlainTextEncryption(true);
   const secretStore = createSecretStore({
      dataPath,
      platform: process.platform,
      protection: safeStorage,
      allowBasicText: isSteamFrame()
   });
   const installRegistry = disposeOnQuit(
      createInstallRegistry({
         dataPath,
         settingsStore,
         detectStores: detectLocalStores
      })
   );
   const telemetry = startTelemetry({ dataPath, appVersion, settings: settingsStore, installs: installRegistry, log });
   if (telemetry) disposeOnQuit(telemetry);
   const installManagement = createInstallManagementService({
      registry: installRegistry,
      operations: operationRegistry,
      settingsStore
   });
   const launchService = createLaunchService({
      settingsStore,
      registry: installRegistry,
      operations: operationRegistry,
      runtime: createLaunchRuntime({ prepareWatchdog: createLaunchWatchdog(dataPath) }),
      prepareArm64: process.platform === 'linux' && process.arch === 'arm64' ? createArm64Launch({ cacheRoot: join(dataPath, 'arm64') }) : undefined
   });
   const ensureProton = async () => ensureSteamProton((await settingsStore.getSnapshot()).library.protonPath, process.arch);
   const downloadService = createLocalDownloads({
      dataPath,
      settingsStore,
      registry: installRegistry,
      operations: operationRegistry,
      log,
      ensureProton
   });
   const mapService = disposeOnQuit(
      createMapService({
         registry: installRegistry,
         operations: operationRegistry,
         staging: contentStaging,
         dataPath,
         log
      })
   );
   const modelService = disposeOnQuit(
      createModelService({
         registry: installRegistry,
         operations: operationRegistry,
         staging: contentStaging,
         dataPath,
         log
      })
   );
   const playlistService = disposeOnQuit(
      createPlaylistService({
         registry: installRegistry,
         operations: operationRegistry,
         maps: mapService,
         staging: contentStaging,
         dataPath,
         log
      })
   );
   const sharedContentService = disposeOnQuit(
      createSharedContentService({
         registry: installRegistry,
         settingsStore,
         operations: operationRegistry,
         log
      })
   );
   const updater = disposeOnQuit(
      createUpdater({
         version: appVersion,
         packaging: createAppPackaging({ packaged: app.isPackaged, platform: process.platform, env: process.env }),
         load: () => loadElectronUpdater(log),
         quit: () => app.quit(),
         log: (message) => void log.info(`updater: ${message}`)
      })
   );
   updater.start();
   const supportLogs = createSupportLogService({
      logsPath: log.logsPath,
      homePath,
      registry: installRegistry
   });
   const modRepositories = createModRepositoryService({
      dataPath,
      settingsStore
   });
   const contentIngestion = createContentIngestionService({ dataPath, staging: contentStaging });
   const modService = createModService({
      registry: installRegistry,
      operations: operationRegistry,
      ingestion: contentIngestion,
      dataPath,
      log,
      catalog: createModCatalogService({
         dataPath,
         log,
         repositories: modRepositories
      }),
      repositories: modRepositories,
      patcher: createModPatcher({ proton: launchService.protonFor })
   });
   const modUploads = createModUploadService({ dataPath, mods: modService });
   const questMutations = createQuestMutationLock();
   const questDevices = disposeOnQuit(
      createQuestDeviceService({
         provisioner: createAdbProvisioner({ dataPath }),
         mutations: questMutations
      })
   );
   const questMods = disposeOnQuit(
      createQuestModService({
         devices: questDevices,
         operations: operationRegistry,
         repositories: modRepositories,
         mutations: questMutations
      })
   );
   const questPatching = createQuestPatchService({
      devices: questDevices,
      operations: operationRegistry,
      dataPath,
      appVersion,
      installCoreMods: questMods.installCoreMods,
      mutations: questMutations
   });
   const questTarget = disposeOnQuit(
      createQuestTarget({
         dataPath,
         ingestion: contentIngestion,
         devices: questDevices,
         mods: questMods,
         operations: operationRegistry,
         patching: questPatching,
         mutations: questMutations
      })
   );
   const installImports = createInstallImportService({
      settingsStore,
      registry: installRegistry
   });
   const localApis = [
      implementApi(downloadsApi, downloadService),
      implementApi(filesApi, createFileBrowser({ platform: process.platform, home: homePath })),
      implementApi(installsApi, { ...installManagement, ...installImports }, { subscribe: installRegistry.subscribe }),
      implementApi(launchApi, launchService, { subscribe: launchService.subscribe }),
      implementApi(mapsApi, mapService, {
         subscribe: mapService.subscribe,
         uploads: { importArchive: mapService.importArchive },
         downloads: { exportArchive: mapService.exportArchive }
      }),
      implementApi(modelsApi, modelService, { subscribe: modelService.subscribe }),
      implementApi(
         modsApi,
         { ...modService, ...modUploads, syncRepositories: modRepositories.sync },
         { uploads: { importFile: modUploads.importFile } }
      ),
      implementApi(operationsApi, operationRegistry, { subscribe: operationRegistry.subscribe }),
      implementApi(playlistsApi, playlistService, { subscribe: playlistService.subscribe }),
      implementApi(sharedContentApi, sharedContentService, { subscribe: sharedContentService.subscribe }),
      implementApi(supportApi, supportLogs),
      implementApi(updatesApi, updater, { subscribe: updater.subscribe })
   ];
   const remoteReceiver = disposeOnQuit(createRemoteReceiverClient({ store: createRemoteTargetStore({ settingsStore, secretStore }) }));
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
   const questHeadsets = disposeOnQuit(
      createQuestHeadsets({
         dataPath,
         local: questTarget,
         remote: remoteReceiver,
         reconnect: async (endpoint) => {
            await questDevices.connectWireless({ endpoint });
         },
         disableWireless: questDevices.disableWireless
      })
   );
   const targetRegistry = createTargetRegistry({ local: localApis, quest: questTarget, headsets: questHeadsets, remote: remoteReceiver });
   const mapSync = createMapSyncService({ registry: targetRegistry, operations: operationRegistry, stagingRoot: join(dataPath, 'map-sync') });
   targetRegistry.serve(implementApi(mapSyncApi, mapSync));
   targetRegistry.serve(implementApi(bsmanagerApi, bsmanagerAdoption));
   const appDataPath = beatSaberAppDataPath({ platform: process.platform, homePath, dataPath });
   const mirrorSource = createMirrorSource({
      installs: installRegistry,
      appDataPath,
      sharedRoots: async () => {
         const library = (await settingsStore.getSnapshot()).library;
         return [library.sharedRoot ?? defaultSharedContentRootPath(library.installRoot), ...library.sharedRoots];
      }
   });
   const mirrorService = disposeOnQuit(
      createMirrorService({
         remote: mirrorRemoteFrom(targetRegistry),
         installs: installRegistry,
         settingsStore,
         operations: operationRegistry,
         platform: process.platform,
         appDataPath,
         stagingRoot: join(dataPath, 'mirror-staging'),
         readSteam: readSteamClientState,
         openSteamLink,
         ensureProton
      })
   );
   targetRegistry.serve(
      implementApi(
         installMirrorApi,
         { ...mirrorSource, ...mirrorService },
         { downloads: { readFile: mirrorSource.readFile, readBatch: mirrorSource.readBatch } }
      )
   );
   const receiver = createReceiverServer({
      settingsStore,
      identityStore: createReceiverIdentityStore({ secretStore }),
      implementations: targetRegistry.served(),
      attached: questTarget,
      getSecretStoreAvailability: () => secretStore.getAvailability()
   });
   teardown.push(async () => {
      await receiver.stop();
   });
   const supportService = createSupportService({
      logs: supportLogs,
      callTarget: targetRegistry.callTarget,
      homePath,
      getAppInfo: createAppInfo
   });

   const backgroundSupported = (process.platform === 'win32' || process.platform === 'linux') && !isSteamFrame();
   let runInBackground = false;
   let appliedStartAtLogin: boolean | null = null;
   let desiredStartAtLogin: boolean | null = null;
   const loginItemQueue = createSerialQueue();
   const trayHost = trayHostAvailable(process.platform);
   const tray = disposeOnQuit(createAppTray({ open: () => showMainWindow(log), quit: () => app.quit() }));
   const loginItem = createLoginItem({
      platform: process.platform,
      packaged: app.isPackaged,
      configPath: process.env.FLATPAK_ID ? join(homePath, '.config') : app.getPath('appData'),
      command: process.env.FLATPAK_ID ? `flatpak run ${process.env.FLATPAK_ID}` : `"${process.env.APPIMAGE ?? process.execPath}"`
   });
   let hasTray = false;
   type QuitState = { status: 'running' } | { status: 'confirming' } | { status: 'waiting'; unsubscribe: () => void } | { status: 'tearing-down' };
   let quitState: QuitState = { status: 'running' };
   const isTearingDown = () => quitState.status === 'tearing-down';

   void trayHost.then((available) => {
      hasTray = available;
      if (!isTearingDown()) tray.setVisible(runInBackground && hasTray);
   });
   const applyBackground = (snapshot: SettingsSnapshot) => {
      if (isTearingDown()) return;

      runInBackground = backgroundSupported && snapshot.app.runInBackground;
      tray.setVisible(runInBackground && hasTray);
      const login = backgroundSupported && snapshot.app.startAtLogin;
      if (login === desiredStartAtLogin) return;

      desiredStartAtLogin = login;
      void loginItemQueue.run(async () => {
         if (isTearingDown() || desiredStartAtLogin !== login || appliedStartAtLogin === login) return;

         const applied = await Result.tryPromise({ try: () => loginItem.apply(login), catch: causeMessage });
         if (Result.isOk(applied)) {
            appliedStartAtLogin = login;
            return;
         }

         if (desiredStartAtLogin === login) desiredStartAtLogin = appliedStartAtLogin;
         void log.warn(`login item: ${applied.error}`);
      });
   };

   settingsStore.subscribe((snapshot) => {
      void receiver.reconcile(snapshot);
      applyBackground(snapshot);
      void watchHeadsets(snapshot);
   });
   void receiver.reconcile();
   void remoteReceiver.restore();
   void contentStaging.purge();
   const watchHeadsets = async (snapshot: SettingsSnapshot) => {
      if (isTearingDown()) return;
      if (snapshot.app.setup !== 'pc' || (await questHeadsets.knowsLocalHeadset())) {
         if (!isTearingDown()) questDevices.start();
      }
   };
   void Promise.all([settingsStore.getSnapshot(), trayHost]).then(([snapshot]) => {
      if (isTearingDown()) return;

      applyBackground(snapshot);
      if (launchedInBackground && !runInBackground) showMainWindow(log);
      else if (launchedInBackground && !hasTray) minimizeMainWindow();
      void watchHeadsets(snapshot);
   });
   setMainWindowCloseBehaviour(() => (!runInBackground || isTearingDown() ? 'close' : hasTray ? 'hide' : 'minimize'));
   app.on('window-all-closed', () => {
      if (process.platform !== 'darwin' && !runInBackground) app.quit();
   });

   function beginTeardown() {
      if (quitState.status === 'tearing-down') return;
      if (quitState.status === 'waiting') quitState.unsubscribe();

      quitState = { status: 'tearing-down' };
      const deadline = new Promise((resolve) => setTimeout(resolve, 3_000));
      void Promise.race([Promise.allSettled(teardown.map(async (dispose) => dispose())), deadline]).then(() => {
         const install = updater.finishInstall();
         if (install === 'started') return;
         if (install === 'failed') app.relaunch();
         app.quit();
      });
   }

   async function confirmQuit(title: string) {
      if (quitState.status !== 'running') return;

      quitState = { status: 'confirming' };
      const choice = await dialog.showMessageBox({
         type: 'warning',
         buttons: [translate('app.quitBlocked.wait'), translate('app.quitBlocked.keepOpen')],
         defaultId: 1,
         cancelId: 1,
         message: translate('app.quitBlocked.message', { title }),
         detail: translate('app.quitBlocked.detail')
      });
      if (quitState.status !== 'confirming') return;

      if (choice.response === 1) {
         quitState = { status: 'running' };
         showMainWindow(log);
         return;
      }

      const quitIfDone = () => {
         if (quitState.status !== 'waiting' || operationRegistry.uncancelable().length > 0) return;

         quitState.unsubscribe();
         quitState = { status: 'running' };
         app.quit();
      };
      const unsubscribe = operationRegistry.subscribeTargets(quitIfDone);
      quitState = { status: 'waiting', unsubscribe };
      quitIfDone();
   }

   app.on('before-quit', (event) => {
      if (quitState.status === 'tearing-down') return;
      event.preventDefault();

      const [blocking] = operationRegistry.uncancelable();
      if (blocking) {
         if (quitState.status === 'running') void confirmQuit(blocking.title);
         return;
      }

      beginTeardown();
   });

   const repositoryLinks = createPendingIpcEvent<ModRepositoryLinkEvent>((event) => broadcastIpcEvent(modsIpc.onRepositoryLinkOpened, event));

   registerIpcModules([
      createAppIpcModule({ trayHost }),
      createSettingsIpcModule(settingsStore),
      createReceiverIpcModule(receiver, remoteReceiver, broadcastIpcEvent),
      createTargetsIpcModule(targetRegistry, broadcastIpcEvent),
      createQuestIpcModule(questDevices, questHeadsets, broadcastIpcEvent, secretStore),
      createInstallsIpcModule(installRegistry),
      createMapsIpcModule(mapService, broadcastIpcEvent),
      createModelsIpcModule(modelService, broadcastIpcEvent),
      createModsIpcModule(modService, modRepositories, targetRegistry, () => repositoryLinks.take()),
      createPlaylistsIpcModule(playlistService, broadcastIpcEvent),
      createSharedContentIpcModule(sharedContentService),
      createShortcutsIpcModule(targetRegistry.callTarget, broadcastIpcEvent, (link) => repositoryLinks.publish(parseModRepositoryLink(link))),
      createSupportIpcModule(supportService)
   ]);
}

function startEncore() {
   electronApp.setAppUserModelId('com.scoresaber.encore');
   setProtocolRegistered(encoreProtocol, true);
   const log = createAppLogWriter({ logsPath: app.getPath('logs'), homePath: app.getPath('home') });
   composeEncore(log);
   void log.info(`app started ${app.getVersion()} on ${process.platform} ${process.arch} (electron ${process.versions.electron})`);
   openMainWindow(log, { hidden: launchedInBackground });
}

const launchedInBackground = process.argv.includes(backgroundLaunchFlag);

if (process.platform === 'linux') app.commandLine.appendSwitch('enable-blink-features', 'WebBluetooth');
if (isSteamFrame()) {
   app.commandLine.appendSwitch('disable-gpu-rasterization');
   app.commandLine.appendSwitch('password-store', 'basic');
}

if (app.requestSingleInstanceLock()) {
   registerDeepLinkIntake([encoreProtocol, ...mapLinkSchemes, modelLinkScheme, playlistLinkScheme], [playlistFileExtension]);
   void app.whenReady().then(startEncore);
} else {
   app.quit();
}

process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
