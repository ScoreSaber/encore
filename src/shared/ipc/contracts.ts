export const IpcChannel = {
   AppInfo: 'app:info',
   UpdateInfo: 'update:info',
   UpdateCheck: 'update:check',
   UpdateInstall: 'update:install',
   UpdateStatus: 'update:status'
} as const;

export type AppPlatform = NodeJS.Platform | 'browser';
export type UpdateStatus = 'disabled' | 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';

export type UpdateSnapshot = {
   status: UpdateStatus;
   version?: string;
   percent?: number;
   message?: string;
};

export type AppInfo = {
   name: string;
   version: string;
   release: {
      channel: 'alpha';
      version: string;
      label: string;
      source: 'release' | 'commit' | 'fallback';
   };
   platform: AppPlatform;
   arch: string;
   electron: string;
   chrome: string;
   node: string;
};

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
