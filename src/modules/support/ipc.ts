import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcQuery } from '@/app/ipc/core';
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
import { targetIdSchema } from '@/modules/targets/contract';

const supportLinkRequestSchema = z.object({
   id: supportLinkIdSchema
});

const supportTargetRequestSchema = z.object({
   targetId: targetIdSchema
});

const supportLogChannelRequestSchema = z.intersection(supportLogReadRequestSchema, supportTargetRequestSchema);

const supportExportChannelRequestSchema = z.object({
   destination: z.enum(['clipboard', 'file']),
   fileName: z.string().min(1),
   text: z.string()
});
type SupportLogChannelRequest = z.infer<typeof supportLogChannelRequestSchema>;

export const supportIpc = defineIpcDescriptor({
   openLink: defineIpcCommand<SupportLinkResult, z.infer<typeof supportLinkRequestSchema>>('support:open-link', supportLinkRequestSchema),
   getLogs: defineIpcQuery<SupportLogsSnapshot, z.infer<typeof supportTargetRequestSchema>>('support:logs', supportTargetRequestSchema),
   readLog: defineIpcQuery<SupportLogExcerpt, SupportLogChannelRequest>('support:log-read', supportLogChannelRequestSchema),
   openLog: defineIpcCommand<SupportLogOpenResult, SupportLogChannelRequest>('support:log-open', supportLogChannelRequestSchema),
   copyLog: defineIpcCommand<SupportExportResult, SupportLogChannelRequest>('support:log-copy', supportLogChannelRequestSchema),
   saveLog: defineIpcCommand<SupportExportResult, SupportLogChannelRequest>('support:log-save', supportLogChannelRequestSchema),
   previewDiagnostics: defineIpcCommand<SupportDiagnosticsBundle, z.infer<typeof supportTargetRequestSchema>>(
      'support:diagnostics-preview',
      supportTargetRequestSchema
   ),
   exportDiagnostics: defineIpcCommand<SupportExportResult, z.infer<typeof supportExportChannelRequestSchema>>(
      'support:diagnostics-export',
      supportExportChannelRequestSchema
   )
});
