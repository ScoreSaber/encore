import { defineIpcMainCommand, defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import type { SettingsStore } from '@/main/settings/settings-store';
import { settingsIpcModule, settingsSnapshotQuery, settingsUpdateAppCommand, settingsUpdateLibraryCommand } from '@/shared/ipc/modules/settings';

export function createSettingsIpcModule(settingsStore: SettingsStore) {
   return defineIpcMainModule(settingsIpcModule, [
      defineIpcMainQuery(settingsSnapshotQuery, () => settingsStore.getSnapshot()),
      defineIpcMainCommand(settingsUpdateAppCommand, (_event, request) => settingsStore.updateAppSettings(request)),
      defineIpcMainCommand(settingsUpdateLibraryCommand, (_event, request) => settingsStore.updateLibrarySettings(request))
   ]);
}
