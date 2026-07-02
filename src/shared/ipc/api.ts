import type { AppInfo, AppPlatform } from '@/shared/ipc/modules/app';
import type { SettingsWriteResult } from '@/shared/ipc/modules/settings';
import type { UpdateSnapshot } from '@/shared/ipc/modules/update';
import type {
   OperationCancelResult,
   OperationDemoStartRequest,
   OperationDemoStartResult,
   OperationEvent,
   OperationId,
   OperationSnapshot
} from '@/shared/operations';
import type { AppSettingsPatch, LibrarySettingsPatch, SettingsSnapshot } from '@/shared/settings';

export type EncoreApi = {
   platform: AppPlatform;
   app: {
      getInfo: () => Promise<AppInfo>;
   };
   settings: {
      getSnapshot: () => Promise<SettingsSnapshot>;
      updateApp: (patch: AppSettingsPatch) => Promise<SettingsWriteResult>;
      updateLibrary: (patch: LibrarySettingsPatch) => Promise<SettingsWriteResult>;
   };
   update: {
      getSnapshot: () => Promise<UpdateSnapshot>;
      checkForUpdates: () => Promise<UpdateSnapshot>;
      installDownloaded: () => Promise<UpdateSnapshot>;
      onStatus: (listener: (update: UpdateSnapshot) => void) => () => void;
   };
   operations: {
      list: () => Promise<OperationSnapshot[]>;
      cancel: (id: OperationId) => Promise<OperationCancelResult>;
      startDemo: (request?: OperationDemoStartRequest) => Promise<OperationDemoStartResult>;
      onSnapshot: (listener: (event: OperationEvent) => void) => () => void;
   };
};
