export const IpcChannel = {
   AppInfo: 'app:info'
} as const;

export type AppPlatform = NodeJS.Platform | 'browser';

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
   };
};
