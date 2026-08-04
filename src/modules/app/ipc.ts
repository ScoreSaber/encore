import { z } from 'zod';

import { defineIpcCommand, defineIpcDescriptor, defineIpcQuery } from '@/app/ipc/core';
import type { AppInfo } from '@/modules/app/contract';

export const appIpc = defineIpcDescriptor({
   copyText: defineIpcCommand<void, { text: string }>('app:copy-text', z.object({ text: z.string() })),
   getInfo: defineIpcQuery<AppInfo>('app:info'),
   quit: defineIpcCommand<void>('app:quit')
});
