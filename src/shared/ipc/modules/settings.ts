import { defineIpcCommand, defineIpcModule, defineIpcQuery, type IpcResult } from '@/shared/ipc/core';
import type { AppSettingsPatch, LibrarySettingsPatch, SettingsSnapshot } from '@/shared/settings';

export type SettingsWriteResult = IpcResult<SettingsSnapshot>;

export const settingsSnapshotQuery = defineIpcQuery<'settings:snapshot', SettingsSnapshot>('settings:snapshot');
export const settingsUpdateAppCommand = defineIpcCommand<'settings:update-app', SettingsWriteResult, AppSettingsPatch>('settings:update-app');
export const settingsUpdateLibraryCommand = defineIpcCommand<'settings:update-library', SettingsWriteResult, LibrarySettingsPatch>(
   'settings:update-library'
);

export const settingsIpcModule = defineIpcModule({
   name: 'settings',
   commands: [settingsUpdateAppCommand, settingsUpdateLibraryCommand],
   queries: [settingsSnapshotQuery],
   events: []
} as const);
