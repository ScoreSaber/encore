import { z } from 'zod';

import { defineIpc, request } from '@/ipc/core';
import {
   supportLinkIdSchema,
   supportLogReadRequestSchema,
   type SupportDiagnosticsBundle,
   type SupportExportResult,
   type SupportLinkResult,
   type SupportLogExcerpt,
   type SupportLogOpenResult,
   type SupportLogsSnapshot
} from '@/modules/support/contract';
import { targetIdRequestSchema } from '@/modules/targets/contract';

const supportLinkRequestSchema = z.object({
   id: supportLinkIdSchema
});

const supportLogChannelRequestSchema = z.intersection(supportLogReadRequestSchema, targetIdRequestSchema);

const supportExportChannelRequestSchema = z.object({
   destination: z.enum(['clipboard', 'file']),
   fileName: z.string().min(1),
   text: z.string()
});

export const supportIpc = defineIpc('support', {
   openLink: request(supportLinkRequestSchema).returns<SupportLinkResult>(),
   getLogs: request(targetIdRequestSchema).returns<SupportLogsSnapshot>(),
   readLog: request(supportLogChannelRequestSchema).returns<SupportLogExcerpt>(),
   openLog: request(supportLogChannelRequestSchema).returns<SupportLogOpenResult>(),
   copyLog: request(supportLogChannelRequestSchema).returns<SupportExportResult>(),
   saveLog: request(supportLogChannelRequestSchema).returns<SupportExportResult>(),
   previewDiagnostics: request(targetIdRequestSchema).returns<SupportDiagnosticsBundle>(),
   exportDiagnostics: request(supportExportChannelRequestSchema).returns<SupportExportResult>()
});
