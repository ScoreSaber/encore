import { z } from 'zod';

export const encoreReleasesUrl = 'https://github.com/ScoreSaber/encore/releases';

export const updateStateSchema = z.object({
   status: z.enum(['disabled', 'idle', 'checking', 'up-to-date', 'available', 'downloading', 'downloaded', 'error']),
   currentVersion: z.string(),
   availableVersion: z.string().nullable(),
   downloadedVersion: z.string().nullable(),
   downloadPercent: z.number().nullable(),
   message: z.string().nullable(),
   errorContext: z.enum(['check', 'download', 'install']).nullable(),
   selfUpdates: z.boolean(),
   disabledReason: z.enum(['development', 'system-managed']).nullable()
});

export type UpdateState = z.infer<typeof updateStateSchema>;
