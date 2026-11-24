import type { IpcMainInvokeEvent } from 'electron';

import { showOpenDialog } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/host';
import { translate } from '@/lib/messages';
import type { InstallRootChoice } from '@/modules/installs/contract';
import { countInstallDirectories, validateInstallRoot } from '@/modules/installs/main/install-root';
import type { ProtonFolderChoice, ProtonState } from '@/modules/launch/contract';
import { findInstalledProton, readLinuxLaunchHost, requestSteamProton, validateProtonFolder } from '@/modules/launch/main/proton';
import { settingsIpc } from '@/modules/settings/ipc';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

import { join } from 'node:path';

export function createSettingsIpcModule(settingsStore: SettingsStore) {
   return defineIpcHandlers<typeof settingsIpc, IpcMainInvokeEvent>(settingsIpc, {
      getSnapshot: () => settingsStore.getSnapshot(),
      getProtonState: () => readProtonState(settingsStore),
      installProton: () => requestSteamProton(process.arch),
      updateApp: (request) => settingsStore.updateAppSettings(request),
      updateLibrary: (request) => settingsStore.updateLibrarySettings(request),
      chooseInstallRoot: (_request, event) => chooseInstallRoot(event, settingsStore),
      chooseProtonFolder: (_request, event) => chooseProtonFolder(event, settingsStore)
   });
}

async function readProtonState(settingsStore: SettingsStore): Promise<ProtonState> {
   const supported = process.platform === 'linux';
   const protonPath = (await settingsStore.getSnapshot()).library.protonPath;

   if (!supported) return { supported, path: protonPath, validation: null, detectedPath: null, nixOs: false, flatpak: false };

   const host = await readLinuxLaunchHost();

   return {
      supported,
      path: protonPath,
      validation: protonPath ? await validateProtonFolder(protonPath, process.arch) : null,
      detectedPath: host.steamClientPath ? await findInstalledProton(host.steamClientPath, process.arch) : null,
      nixOs: host.nixOs,
      flatpak: host.flatpak
   };
}

async function chooseProtonFolder(event: IpcMainInvokeEvent, settingsStore: SettingsStore): Promise<ProtonFolderChoice> {
   const [settings, host] = await Promise.all([settingsStore.getSnapshot(), readLinuxLaunchHost()]);
   const defaultPath = settings.library.protonPath ?? (host.steamClientPath ? join(host.steamClientPath, 'steamapps', 'common') : undefined);
   const picked = await showOpenDialog(event, {
      title: translate('launch.proton.dialogTitle'),
      buttonLabel: translate('launch.proton.dialogButton'),
      properties: ['openDirectory'],
      defaultPath
   });
   if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' };

   return { status: 'selected', selected: await validateProtonFolder(picked.filePaths[0], process.arch) };
}

async function chooseInstallRoot(event: IpcMainInvokeEvent, settingsStore: SettingsStore): Promise<InstallRootChoice> {
   const currentRoot = (await settingsStore.getSnapshot()).library.installRoot;
   const picked = await showOpenDialog(event, { properties: ['openDirectory', 'createDirectory'], defaultPath: currentRoot });
   if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' };

   return {
      status: 'selected',
      currentRoot,
      currentInstallCount: await countInstallDirectories(currentRoot),
      selected: await validateInstallRoot({ path: picked.filePaths[0], currentRoot })
   };
}
