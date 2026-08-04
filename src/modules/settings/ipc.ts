import { defineIpcDescriptor, defineIpcCommand, defineIpcQuery, type IpcResult } from '@/app/ipc/core';
import type { InstallRootChoice } from '@/modules/installs/contract';
import type { ProtonFolderChoice, ProtonState } from '@/modules/launch/contract';
import {
   appSettingsPatchSchema,
   librarySettingsPatchSchema,
   type AppSettingsPatch,
   type LibrarySettingsPatch,
   type SettingsSnapshot
} from '@/modules/settings/contract';

export type SettingsWriteResult = IpcResult<SettingsSnapshot>;

export const settingsIpc = defineIpcDescriptor({
   getSnapshot: defineIpcQuery<SettingsSnapshot>('settings:snapshot'),
   updateApp: defineIpcCommand<SettingsWriteResult, AppSettingsPatch>('settings:update-app', appSettingsPatchSchema),
   updateLibrary: defineIpcCommand<SettingsWriteResult, LibrarySettingsPatch>('settings:update-library', librarySettingsPatchSchema),

   chooseInstallRoot: defineIpcCommand<InstallRootChoice>('settings:choose-install-root'),

   getProtonState: defineIpcQuery<ProtonState>('settings:proton-state'),
   chooseProtonFolder: defineIpcCommand<ProtonFolderChoice>('settings:choose-proton-folder')
});
