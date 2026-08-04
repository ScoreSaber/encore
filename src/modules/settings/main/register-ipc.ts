import type { IpcMainInvokeEvent } from 'electron';

import { showOpenDialog } from '@/app/ipc/dialogs';
import { defineIpcHandlers } from '@/app/ipc/main';
import type { InstallRootChoice } from '@/modules/installs/contract';
import { countInstallDirectories, validateInstallRoot } from '@/modules/installs/main/install-root';
import type { ProtonFolderChoice, ProtonState } from '@/modules/launch/contract';
import { readLinuxLaunchHost, validateProtonFolder } from '@/modules/launch/main/proton';
import { settingsIpc } from '@/modules/settings/ipc';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

export function createSettingsIpcModule(settingsStore: SettingsStore) {
   return defineIpcHandlers(settingsIpc, {
      getSnapshot: () => settingsStore.getSnapshot(),
      getProtonState: () => readProtonState(settingsStore),
      updateApp: (_event, request) => settingsStore.updateAppSettings(request),
      updateLibrary: (_event, request) => settingsStore.updateLibrarySettings(request),
      chooseInstallRoot: (event) => chooseInstallRoot(event, settingsStore),
      chooseProtonFolder: chooseProtonFolder
   });
}

async function readProtonState(settingsStore: SettingsStore): Promise<ProtonState> {
   const supported = process.platform === 'linux';
   const protonPath = (await settingsStore.getSnapshot()).library.protonPath;

   if (!supported) return { supported, path: protonPath, validation: null, nixOs: false, flatpak: false };

   const host = await readLinuxLaunchHost();

   return {
      supported,
      path: protonPath,
      validation: protonPath ? await validateProtonFolder(protonPath) : null,
      nixOs: host.nixOs,
      flatpak: host.flatpak
   };
}

async function chooseProtonFolder(event: IpcMainInvokeEvent): Promise<ProtonFolderChoice> {
   const picked = await showOpenDialog(event, { properties: ['openDirectory'] });
   if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' };

   return { status: 'selected', selected: await validateProtonFolder(picked.filePaths[0]) };
}

async function chooseInstallRoot(event: IpcMainInvokeEvent, settingsStore: SettingsStore): Promise<InstallRootChoice> {
   const picked = await showOpenDialog(event, { properties: ['openDirectory', 'createDirectory'] });
   if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' };

   const currentRoot = (await settingsStore.getSnapshot()).library.installRoot;

   return {
      status: 'selected',
      currentRoot,
      currentInstallCount: await countInstallDirectories(currentRoot),
      selected: await validateInstallRoot({ path: picked.filePaths[0], currentRoot })
   };
}
