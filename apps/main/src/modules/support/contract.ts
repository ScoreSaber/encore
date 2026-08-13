import { z } from 'zod';

export const supportLinkIdSchema = z.enum([
   'support-encore',
   'give-feedback',
   'source-code',
   'report-issue',
   'bsmg-discord',
   'scoresaber-discord',
   'beatmods',
   'beatsaver',
   'scoresaber',
   'modelsaber',
   'encore-docs',
   'bsmg-wiki',
   'scoresaber-wiki'
]);
export type SupportLinkId = z.infer<typeof supportLinkIdSchema>;
type QuickLinkId = Exclude<SupportLinkId, 'modelsaber'>;
export type QuickLinkSectionId = 'encore' | 'support' | 'services' | 'wikis';

export const quickLinkSections: { id: QuickLinkSectionId; links: readonly QuickLinkId[] }[] = [
   { id: 'encore', links: ['give-feedback', 'source-code', 'report-issue', 'support-encore'] },
   { id: 'support', links: ['bsmg-discord', 'scoresaber-discord'] },
   { id: 'services', links: ['beatmods', 'beatsaver', 'scoresaber'] },
   { id: 'wikis', links: ['encore-docs', 'bsmg-wiki', 'scoresaber-wiki'] }
];

export const supportLinkUrls = {
   'support-encore': 'https://github.com/scoresaber/encore?sponsor=1',
   'give-feedback': 'https://hub.scoresaber.com/',
   'source-code': 'https://github.com/scoresaber/encore',
   'report-issue': 'https://github.com/scoresaber/encore/issues/new',
   'bsmg-discord': 'https://discord.gg/beatsabermods',
   'scoresaber-discord': 'https://discord.scoresaber.com/',
   beatmods: 'https://beatmods.com/',
   beatsaver: 'https://beatsaver.com/',
   scoresaber: 'https://scoresaber.com/',
   modelsaber: 'https://modelsaber.com/',
   'encore-docs': 'https://encore.scoresaber.com/docs',
   'bsmg-wiki': 'https://bsmg.wiki/',
   'scoresaber-wiki': 'https://wiki.scoresaber.com/'
};

const supportLinkResultSchema = z.object({
   id: supportLinkIdSchema,
   status: z.enum(['opened', 'blocked']),
   reason: z.string().optional()
});

export const supportLogGroupStatusSchema = z.enum(['ready', 'missing', 'unreadable', 'unsupported']);
export const supportLogIssueSchema = z.enum(['invalid-path', 'not-found', 'unreadable', 'unsupported-target']);

const supportLogFileSchema = z.object({
   id: z.string().min(1),
   sizeBytes: z.int().nonnegative(),
   modifiedAt: z.string()
});

export const supportInstallLogFileSchema = supportLogFileSchema.extend({
   installId: z.string().min(1),
   installName: z.string().min(1)
});

export const supportAppLogGroupSchema = z.object({
   source: z.literal('app'),
   status: supportLogGroupStatusSchema,
   rootPath: z.string().nullable(),
   files: z.array(supportLogFileSchema),
   detail: z.string().optional()
});

export const supportInstallLogGroupSchema = z.object({
   source: z.literal('install'),
   status: supportLogGroupStatusSchema,
   rootPath: z.null(),
   files: z.array(supportInstallLogFileSchema),
   detail: z.string().optional()
});

export const supportLogGroupSchema = z.discriminatedUnion('source', [supportAppLogGroupSchema, supportInstallLogGroupSchema]);

const supportLogsSnapshotSchema = z.object({
   targetId: z.string(),
   scannedAt: z.string(),
   groups: z.array(supportLogGroupSchema)
});

export const supportLogReadRequestSchema = z.discriminatedUnion('source', [
   z.object({
      source: z.literal('app'),
      fileId: z.string().min(1)
   }),
   z.object({
      source: z.literal('install'),
      installId: z.string().min(1),
      fileId: z.string().min(1)
   })
]);

export const supportInstallLogReadRequestSchema = z.object({
   installId: z.string().min(1),
   fileId: z.string().min(1)
});

export const supportLogExcerptSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('ready'),
      text: z.string()
   }),
   z.object({
      status: z.literal('unavailable'),
      issue: supportLogIssueSchema,
      detail: z.string().optional()
   })
]);

const supportDiagnosticsBundleSchema = z.object({
   fileName: z.string(),
   text: z.string(),
   sizeBytes: z.int().nonnegative(),
   logs: z.array(
      z.discriminatedUnion('included', [
         z.object({ fileId: z.string(), included: z.literal(true) }),
         z.object({ fileId: z.string(), included: z.literal(false), issue: supportLogIssueSchema })
      ])
   )
});

const supportExportResultSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('saved'), path: z.string() }),
   z.object({ status: z.literal('copied') }),
   z.object({ status: z.literal('cancelled') }),
   z.object({ status: z.literal('failed'), message: z.string() })
]);

const supportLogOpenResultSchema = z.discriminatedUnion('status', [
   z.object({ status: z.literal('opened') }),
   z.object({ status: z.literal('failed'), message: z.string() })
]);

export type SupportLinkResult = z.infer<typeof supportLinkResultSchema>;
export type SupportLogIssue = z.infer<typeof supportLogIssueSchema>;
export type SupportLogFile = z.infer<typeof supportLogFileSchema>;
export type SupportInstallLogFile = z.infer<typeof supportInstallLogFileSchema>;
export type SupportLogGroup = z.infer<typeof supportLogGroupSchema>;
export type SupportAppLogGroup = z.infer<typeof supportAppLogGroupSchema>;
export type SupportInstallLogGroup = z.infer<typeof supportInstallLogGroupSchema>;
export type SupportLogsSnapshot = z.infer<typeof supportLogsSnapshotSchema>;
export type SupportLogReadRequest = z.infer<typeof supportLogReadRequestSchema>;
export type SupportInstallLogReadRequest = z.infer<typeof supportInstallLogReadRequestSchema>;
export type SupportLogExcerpt = z.infer<typeof supportLogExcerptSchema>;
export type SupportDiagnosticsBundle = z.infer<typeof supportDiagnosticsBundleSchema>;
export type SupportExportResult = z.infer<typeof supportExportResultSchema>;
export type SupportLogOpenResult = z.infer<typeof supportLogOpenResultSchema>;

export type SupportLogSelection = SupportLogReadRequest;

export function unavailableSupportLogExcerpt(issue: SupportLogIssue, detail?: string): SupportLogExcerpt {
   const excerpt: SupportLogExcerpt = { status: 'unavailable', issue };
   if (detail) excerpt.detail = detail;
   return excerpt;
}
