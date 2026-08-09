import { z } from 'zod';

import { defineIpcDescriptor, defineIpcCommand, defineIpcEvent, defineIpcQuery } from '@/ipc/core';
import { launchOptionsSchema } from '@/modules/launch/contract';
import {
   shortcutKindSchema,
   type LaunchLinkEvent,
   type ShortcutPreview,
   type ShortcutProtocolResult,
   type ShortcutRequest,
   type ShortcutResult,
   type ShortcutState
} from '@/modules/shortcuts/contract';
import { targetInstallRequestSchema } from '@/modules/targets/ipc';

const shortcutRequestSchema = targetInstallRequestSchema.extend({
   kind: shortcutKindSchema,
   options: launchOptionsSchema
});

const shortcutProtocolRequestSchema = z.object({
   registered: z.boolean()
});

export const shortcutsIpc = defineIpcDescriptor({
   getState: defineIpcQuery<ShortcutState>('shortcuts:state'),
   preview: defineIpcCommand<ShortcutPreview, ShortcutRequest>('shortcuts:preview', shortcutRequestSchema),
   create: defineIpcCommand<ShortcutResult, ShortcutRequest>('shortcuts:create', shortcutRequestSchema),
   setProtocolRegistered: defineIpcCommand<ShortcutProtocolResult, { registered: boolean }>('shortcuts:set-protocol', shortcutProtocolRequestSchema),

   onLinkOpened: defineIpcEvent<LaunchLinkEvent>('shortcuts:link-opened')
});
