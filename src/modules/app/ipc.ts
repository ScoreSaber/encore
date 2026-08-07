import { z } from 'zod';

import { defineIpcCommand, defineIpcDescriptor, defineIpcQuery } from '@/app/ipc/core';
import { externalLinkRequestSchema, type AppInfo, type ExternalLinkRequest, type ExternalLinkResult } from '@/modules/app/contract';

export const appIpc = defineIpcDescriptor({
   copyText: defineIpcCommand<void, { text: string }>('app:copy-text', z.object({ text: z.string() })),
   getInfo: defineIpcQuery<AppInfo>('app:info'),
   openLink: defineIpcCommand<ExternalLinkResult, ExternalLinkRequest>('app:open-link', externalLinkRequestSchema),
   quit: defineIpcCommand<void>('app:quit')
});
