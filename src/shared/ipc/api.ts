import type { AppInfo, AppPlatform } from '@/shared/ipc/modules/app';
import type { UpdateSnapshot } from '@/shared/ipc/modules/update';

export type EncoreApi = {
   platform: AppPlatform;
   app: {
      getInfo: () => Promise<AppInfo>;
   };
   update: {
      getSnapshot: () => Promise<UpdateSnapshot>;
      checkForUpdates: () => Promise<UpdateSnapshot>;
      installDownloaded: () => Promise<UpdateSnapshot>;
      onStatus: (listener: (update: UpdateSnapshot) => void) => () => void;
   };
};
