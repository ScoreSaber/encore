import { z } from 'zod';

import type { IpcResult } from '@/app/ipc/core';
import type { InstallId } from '@/modules/installs/contract';
import { launchArgsSchema, launchFlagSchema, launchFlags, launchPlatformSchema, type LaunchOptions } from '@/modules/launch/contract';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

export const encoreProtocol = 'encore';
export const launchLinkAction = 'launch';
const launchLinkPrefix = `${encoreProtocol}://`;

// links may name IDs, never paths or commands
const linkIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const launchLinkParamsSchema = z.object({
   target: linkIdSchema,
   install: linkIdSchema,
   flags: z.array(launchFlagSchema).max(launchFlags.length),
   args: launchArgsSchema,
   admin: z.stringbool({ truthy: ['1'], falsy: ['0'] }).catch(false),
   close: z.stringbool({ truthy: ['1'], falsy: ['0'] }).catch(false)
});

const launchLinkIssueSchema = z.enum(['unknown-action', 'unknown-install', 'invalid-request', 'unsupported-link']);

export const shortcutKindSchema = z.enum(['desktop', 'steam']);
export const shortcutKinds = shortcutKindSchema.options;

const shortcutIssueSchema = z.enum([
   'install-not-found',
   'invalid-options',
   'steam-client-missing',
   'steam-file-unreadable',
   'steam-user-missing',
   'unsupported-kind',
   'unsupported-platform',
   'write-failed'
]);

const shortcutWarningSchema = z.enum(['replaces-existing', 'steam-must-be-closed']);

export const shortcutProtocolStateSchema = z.object({
   scheme: z.literal(encoreProtocol),
   registered: z.boolean(),
   canUnregister: z.boolean()
});

const shortcutStateSchema = z.object({
   platform: launchPlatformSchema,
   kinds: z.array(shortcutKindSchema),
   protocol: shortcutProtocolStateSchema
});

export type LaunchLinkIssue = z.infer<typeof launchLinkIssueSchema>;
export type ShortcutKind = z.infer<typeof shortcutKindSchema>;
export type ShortcutIssue = z.infer<typeof shortcutIssueSchema>;
export type ShortcutWarning = z.infer<typeof shortcutWarningSchema>;
export type ShortcutProtocolState = z.infer<typeof shortcutProtocolStateSchema>;
export type ShortcutState = z.infer<typeof shortcutStateSchema>;

export type LaunchLinkRequest = {
   targetId: TargetId;
   installId: InstallId;
   options: LaunchOptions;
};

export type LaunchLinkParse = { status: 'ok'; request: LaunchLinkRequest } | { status: 'invalid'; issue: LaunchLinkIssue };

export type LaunchLinkEvent =
   | { status: 'ready'; request: LaunchLinkRequest; installName: string }
   | { status: 'rejected'; issue: LaunchLinkIssue; detail?: string };

export type ShortcutRequest = {
   targetId: TargetId;
   installId: InstallId;
   kind: ShortcutKind;
   options: LaunchOptions;
};

export type UnavailableShortcutPreview = {
   status: 'unavailable';
   kind: ShortcutKind;
   targetId: TargetId;
   installId: InstallId;
   issue: ShortcutIssue;
   detail?: string;
};

export type ReadyShortcutPreview = {
   status: 'ok';
   kind: ShortcutKind;
   targetId: TargetId;
   installId: InstallId;
   name: string;
   shortcutPath: string;
   executablePath: string;
   link: string;
   warnings: ShortcutWarning[];
};

export type ShortcutPreview = UnavailableShortcutPreview | ReadyShortcutPreview;

export type ShortcutSummary = {
   kind: ShortcutKind;
   name: string;
   shortcutPath: string;
   link: string;
};

export type ShortcutResult = IpcResult<ShortcutSummary>;
export type ShortcutProtocolResult = IpcResult<ShortcutProtocolState>;

export function buildLaunchLink(request: LaunchLinkRequest) {
   const url = new URL(`${launchLinkPrefix}${launchLinkAction}`);
   url.searchParams.set('target', request.targetId);
   url.searchParams.set('install', request.installId);

   for (const flag of request.options.flags) {
      url.searchParams.append('flag', flag);
   }

   for (const arg of request.options.args) {
      url.searchParams.append('arg', arg);
   }

   if (request.options.runAsAdmin) url.searchParams.set('admin', '1');
   if (request.options.closeEncore) url.searchParams.set('close', '1');

   return url.toString();
}

export function parseLaunchLink(value: string): LaunchLinkParse {
   const url = URL.canParse(value) ? new URL(value) : null;
   if (!url || url.protocol !== `${encoreProtocol}:`) return { status: 'invalid', issue: 'unsupported-link' };
   if (url.host !== launchLinkAction || (url.pathname !== '' && url.pathname !== '/')) return { status: 'invalid', issue: 'unknown-action' };

   const parsed = launchLinkParamsSchema.safeParse({
      target: url.searchParams.get('target') ?? localTargetId,
      install: url.searchParams.get('install') ?? '',
      flags: [...new Set(url.searchParams.getAll('flag'))],
      args: url.searchParams.getAll('arg'),
      admin: url.searchParams.get('admin'),
      close: url.searchParams.get('close')
   });

   if (!parsed.success) return { status: 'invalid', issue: 'invalid-request' };

   return {
      status: 'ok',
      request: {
         targetId: parsed.data.target,
         installId: parsed.data.install,
         options: { flags: parsed.data.flags, args: parsed.data.args, runAsAdmin: parsed.data.admin, closeEncore: parsed.data.close }
      }
   };
}

export function unavailableShortcutPreview(
   request: { kind: ShortcutKind; targetId: TargetId; installId: InstallId },
   issue: ShortcutIssue,
   detail?: string
): UnavailableShortcutPreview {
   return {
      status: 'unavailable',
      kind: request.kind,
      targetId: request.targetId,
      installId: request.installId,
      issue,
      ...(detail ? { detail } : {})
   };
}
