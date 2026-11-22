import { defineIpc, request, type IpcResult } from '@/ipc/core';
import type { InstallRootChoice } from '@/modules/installs/contract';
import type { ProtonFolderChoice, ProtonState } from '@/modules/launch/contract';
import { appSettingsPatchSchema, librarySettingsPatchSchema, type SettingsSnapshot } from '@/modules/settings/contract';

export type SettingsWriteResult = IpcResult<SettingsSnapshot>;

export const settingsIpc = defineIpc('settings', {
   getSnapshot: request().returns<SettingsSnapshot>(),
   updateApp: request(appSettingsPatchSchema).returns<SettingsWriteResult>(),
   updateLibrary: request(librarySettingsPatchSchema).returns<SettingsWriteResult>(),

   chooseInstallRoot: request().returns<InstallRootChoice>(),

   getProtonState: request().returns<ProtonState>(),
   installProton: request().returns<boolean>(),
   chooseProtonFolder: request().returns<ProtonFolderChoice>()
});
