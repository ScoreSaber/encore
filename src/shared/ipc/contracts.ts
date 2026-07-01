import { appInfoQuery, type AppInfo, type AppPlatform } from '@/shared/ipc/modules/app';
import {
   updateCheckCommand,
   updateInfoQuery,
   updateInstallCommand,
   updateStatusEvent,
   type UpdateSnapshot,
   type UpdateStatus
} from '@/shared/ipc/modules/update';

export type { AppInfo, AppPlatform, UpdateSnapshot, UpdateStatus };

export const IpcChannel = {
   AppInfo: appInfoQuery.channel,
   UpdateInfo: updateInfoQuery.channel,
   UpdateCheck: updateCheckCommand.channel,
   UpdateInstall: updateInstallCommand.channel,
   UpdateStatus: updateStatusEvent.channel
} as const;

export type EncoreApi = {
   platform: AppPlatform;
   app: {
      getInfo: () => Promise<AppInfo>;
      getUpdate: () => Promise<UpdateSnapshot>;
      checkForUpdates: () => Promise<UpdateSnapshot>;
      installUpdate: () => Promise<UpdateSnapshot>;
      onUpdateStatus: (listener: (update: UpdateSnapshot) => void) => () => void;
   };
};
