import { z } from 'zod';

import { defineIpc, request } from '@/ipc/core';
import { externalLinkRequestSchema, pathChoiceRequestSchema, type AppInfo, type ExternalLinkResult, type PathChoice } from '@/modules/app/contract';

const copyTextRequestSchema = z.object({ text: z.string() });

export const appIpc = defineIpc('app', {
   copyText: request(copyTextRequestSchema),
   getInfo: request().returns<AppInfo>(),
   openLink: request(externalLinkRequestSchema).returns<ExternalLinkResult>(),
   choosePath: request(pathChoiceRequestSchema).returns<PathChoice>(),
   hasTray: request().returns<boolean>(),
   quit: request()
});
