import { z } from 'zod';

import type { IpcResult } from '@/app/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import { operationSnapshotSchema, type OperationSnapshot } from '@/modules/operations/contract';
import { storeKindSchema } from '@/modules/stores/contract';
import type { TargetId } from '@/modules/targets/contract';

export const protonIssueSchema = z.enum([
   'empty',
   'inspect-failed',
   'not-a-directory',
   'not-absolute',
   'not-found',
   'proton-binary-missing',
   'wine-binary-missing'
]);

export const protonValidationSchema = z.discriminatedUnion('status', [
   z.object({
      status: z.literal('ok'),
      path: z.string(),
      protonBinaryPath: z.string(),
      wineBinaryPath: z.string()
   }),
   z.object({
      status: z.literal('invalid'),
      path: z.string(),
      issue: protonIssueSchema
   })
]);

export const protonLaunchPlanSchema = z.object({
   protonBinaryPath: z.string(),
   compatDataPath: z.string(),
   steamClientPath: z.string(),
   steamRunWrapper: z.boolean(),
   logPath: z.string().nullable()
});

export const protonStateSchema = z.object({
   supported: z.boolean(),
   path: z.string().nullable(),
   validation: protonValidationSchema.nullable(),
   nixOs: z.boolean(),
   flatpak: z.boolean()
});

export type ProtonIssue = z.infer<typeof protonIssueSchema>;
export type ProtonValidation = z.infer<typeof protonValidationSchema>;
export type ProtonLaunchPlan = z.infer<typeof protonLaunchPlanSchema>;
export type ProtonState = z.infer<typeof protonStateSchema>;

export type ProtonFolderChoice = { status: 'cancelled' } | { status: 'selected'; selected: ProtonValidation };

export function invalidProtonFolder(path: string, issue: ProtonIssue): ProtonValidation {
   return { status: 'invalid', path, issue };
}

export const launchPlatformSchema = z.enum(['windows', 'linux', 'other']);

export const launchFlagSchema = z.enum(['oculus-mode', 'fpfc', 'debug', 'skip-steam', 'editor', 'proton-logs']);
export const launchFlags = launchFlagSchema.options;

const platformLaunchFlags: Record<LaunchPlatform, readonly LaunchFlag[]> = {
   windows: launchFlags.filter((flag) => flag !== 'proton-logs'),
   linux: launchFlags.filter((flag) => flag !== 'skip-steam'),
   other: launchFlags
};

export const launchArgSchema = z
   // arguments cross process boundaries; do not hand control characters to a launcher
   .string()
   .trim()
   .min(1)
   .max(256)
   .refine((value) => !/\p{Cc}/u.test(value));
export const launchArgsSchema = z.array(launchArgSchema).max(24);

export const launchOptionsSchema = z.object({
   flags: z.array(launchFlagSchema).max(launchFlags.length),
   args: launchArgsSchema,
   runAsAdmin: z.boolean()
});

export const launchRequestBodySchema = z.object({
   installId: z.string().min(1),
   options: launchOptionsSchema
});

export const launchIssueSchema = z.enum([
   'executable-missing',
   'inspect-failed',
   'invalid-options',
   'not-found',
   'proton-not-found',
   'proton-not-set',
   'store-client-missing',
   'unsupported-platform',
   'unsupported-target'
]);

export const launchWarningSchema = z.enum([
   'admin-prompt',
   'admin-unsupported',
   'oculus-client-starts',
   'proton-logs',
   'steam-client-starts',
   'steam-skipped'
]);

export const unavailableLaunchPreviewSchema = z.object({
   status: z.literal('unavailable'),
   installId: z.string(),
   issue: launchIssueSchema,
   detail: z.string().optional()
});

export const readyLaunchPreviewSchema = z.object({
   status: z.literal('ok'),
   installId: z.string(),
   name: z.string(),
   store: storeKindSchema.nullable(),
   version: z.string().nullable(),
   executablePath: z.string(),
   workingDirectory: z.string(),
   args: z.array(z.string()),
   options: launchOptionsSchema,
   proton: protonLaunchPlanSchema.nullable(),
   warnings: z.array(launchWarningSchema)
});

export const launchPreviewSchema = z.discriminatedUnion('status', [unavailableLaunchPreviewSchema, readyLaunchPreviewSchema]);

export const launchRecordSchema = z.object({
   installId: z.string(),
   launchedAt: z.string(),
   options: launchOptionsSchema
});

export const launchStateSchema = z.object({
   platform: launchPlatformSchema,
   supported: z.boolean(),
   lastLaunch: launchRecordSchema.nullable()
});

export const launchResultSchema = z.union([
   z.object({ ok: z.literal(true), value: operationSnapshotSchema }),
   z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) })
]);

export type LaunchPlatform = z.infer<typeof launchPlatformSchema>;
export type LaunchFlag = z.infer<typeof launchFlagSchema>;
export type LaunchOptions = z.infer<typeof launchOptionsSchema>;
export type LaunchRequestBody = z.infer<typeof launchRequestBodySchema>;
export type LaunchIssue = z.infer<typeof launchIssueSchema>;
export type LaunchWarning = z.infer<typeof launchWarningSchema>;
export type UnavailableLaunchPreview = z.infer<typeof unavailableLaunchPreviewSchema>;
export type ReadyLaunchPreview = z.infer<typeof readyLaunchPreviewSchema>;
export type LaunchPreview = z.infer<typeof launchPreviewSchema>;
export type LaunchRecord = z.infer<typeof launchRecordSchema>;
export type LaunchState = z.infer<typeof launchStateSchema>;
export type TargetLaunchPreview = { targetId: TargetId } & LaunchPreview;
export type TargetUnavailableLaunchPreview = { targetId: TargetId } & UnavailableLaunchPreview;
export type TargetReadyLaunchPreview = { targetId: TargetId } & ReadyLaunchPreview;
export type LaunchResult = IpcResult<OperationSnapshot>;

export type LaunchRequest = {
   targetId: TargetId;
   installId: InstallId;
   options: LaunchOptions;
};

export function launchPlatformFor(platform: NodeJS.Platform): LaunchPlatform {
   if (platform === 'win32') return 'windows';
   if (platform === 'linux') return 'linux';
   return 'other';
}

export function launchFlagsFor(platform: LaunchPlatform): readonly LaunchFlag[] {
   return platformLaunchFlags[platform];
}

export function unavailableLaunchPreview(request: { installId: InstallId }, issue: LaunchIssue, detail?: string): UnavailableLaunchPreview {
   return {
      status: 'unavailable',
      installId: request.installId,
      issue,
      ...(detail ? { detail } : {})
   };
}

export function parseLaunchArgs(input: string): string[] {
   const args: string[] = [];
   let current = '';
   let quote: '"' | "'" | null = null;
   let quoted = false;

   for (const character of input) {
      if (quote) {
         if (character === quote) quote = null;
         else current += character;
         continue;
      }

      if (character === '"' || character === "'") {
         quote = character;
         quoted = true;
         continue;
      }

      if (/\s/.test(character)) {
         if (current || quoted) args.push(current);
         current = '';
         quoted = false;
         continue;
      }

      current += character;
   }

   if (current || quoted) args.push(current);
   return args.filter((arg) => arg.length > 0);
}

export function formatLaunchArgs(args: readonly string[]) {
   return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
}
