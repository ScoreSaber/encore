import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/app/ipc/core';
import type { UpdateSnapshot } from '@/modules/updates/contract';

export const updatesIpc = defineIpcDescriptor({
   getSnapshot: defineIpcQuery<UpdateSnapshot>('update:info'),
   checkForUpdates: defineIpcCommand<UpdateSnapshot>('update:check'),
   installDownloaded: defineIpcCommand<UpdateSnapshot>('update:install'),
   onStatus: defineIpcEvent<UpdateSnapshot>('update:status')
});
