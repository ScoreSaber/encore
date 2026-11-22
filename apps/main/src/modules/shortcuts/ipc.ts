import { defineIpc, event, linkRegistrationSchema, request } from '@/ipc/core';
import { launchOptionsSchema } from '@/modules/launch/contract';
import {
   shortcutKindSchema,
   type LaunchLinkEvent,
   type ShortcutPreview,
   type ShortcutProtocolResult,
   type ShortcutResult,
   type ShortcutState
} from '@/modules/shortcuts/contract';
import { targetInstallRequestSchema } from '@/modules/targets/contract';

const shortcutRequestSchema = targetInstallRequestSchema.extend({
   kind: shortcutKindSchema,
   options: launchOptionsSchema
});

export const shortcutsIpc = defineIpc('shortcuts', {
   getState: request().returns<ShortcutState>(),
   preview: request(shortcutRequestSchema).returns<ShortcutPreview>(),
   create: request(shortcutRequestSchema).returns<ShortcutResult>(),
   setProtocolRegistered: request(linkRegistrationSchema).returns<ShortcutProtocolResult>(),

   onLinkOpened: event<LaunchLinkEvent>(),
   takePendingLink: request().returns<LaunchLinkEvent | null>()
});
