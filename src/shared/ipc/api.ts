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
import type { InstallSummary, StoreDetectionSnapshot, Target, TargetEvent, TargetHealth, TargetId } from '@/shared/targets';

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
   targets: {
      list: () => Promise<Target[]>;
      listInstalls: (targetId: TargetId) => Promise<InstallSummary[]>;
      getHealth: (targetId: TargetId) => Promise<TargetHealth | null>;
      getStoreDetection: (targetId: TargetId) => Promise<StoreDetectionSnapshot | null>;
      rescanStores: (targetId: TargetId) => Promise<StoreDetectionSnapshot | null>;
      onEvent: (listener: (event: TargetEvent) => void) => () => void;
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
