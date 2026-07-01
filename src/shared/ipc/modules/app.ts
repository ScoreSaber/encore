import { defineIpcModule, defineIpcQuery } from '@/shared/ipc/core';

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

export const appInfoQuery = defineIpcQuery<'app:info', AppInfo>('app:info');

export const appIpcModule = defineIpcModule({
   name: 'app',
   commands: [],
   queries: [appInfoQuery],
   events: []
} as const);
