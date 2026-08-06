import { z } from 'zod';

import { localeSchema } from '@/app/renderer/i18n/config';
import { launchRecordSchema } from '@/modules/launch/contract';
import { modRepositoryRecordSchema, modSourceResolutionSettingsSchema } from '@/modules/mods/contract';
import {
   accentColorSchema,
   appSettingsSchema,
   librarySettingsSchema,
   modGroupSettingsSchema,
   pairedDeviceSchema,
   remoteTargetRecordSchema,
   themeSchema,
   type AppSettings,
   type LibrarySettings
} from '@/modules/settings/contract';

export const storedSettingsFileSchema = z.object({
   app: appSettingsSchema,
   library: librarySettingsSchema
});

export type StoredSettingsFile = z.infer<typeof storedSettingsFileSchema>;

export function createRecoverableStoredSettingsFileSchema(defaults: { app: AppSettings; library: LibrarySettings }) {
   const receiver = z
      .object({
         enabled: z.boolean().catch(defaults.app.receiver.enabled),
         interfaceName: z.string().nullable().catch(defaults.app.receiver.interfaceName),
         pairedDevices: z.array(pairedDeviceSchema).catch(defaults.app.receiver.pairedDevices),
         remoteTargets: z.array(remoteTargetRecordSchema).catch(defaults.app.receiver.remoteTargets)
      })
      .catch(defaults.app.receiver);
   const selection = z
      .object({
         targetId: z.string().trim().min(1).catch(defaults.app.selection.targetId),
         installIds: z.record(z.string().trim().min(1), z.string().trim().min(1)).catch(defaults.app.selection.installIds)
      })
      .catch(defaults.app.selection);
   const app = z
      .object({
         theme: themeSchema.catch(defaults.app.theme),
         accentColor: accentColorSchema.catch(defaults.app.accentColor),
         locale: localeSchema.catch(defaults.app.locale),
         selection,
         receiver,
         modRepositories: z.array(modRepositoryRecordSchema).catch(defaults.app.modRepositories),
         officialModSourceEnabled: z.boolean().catch(defaults.app.officialModSourceEnabled),
         modSourceResolution: modSourceResolutionSettingsSchema.catch(defaults.app.modSourceResolution),
         alphaWarningAccepted: z.boolean().catch(defaults.app.alphaWarningAccepted),
         bsmanagerPromptDismissed: z.boolean().catch(defaults.app.bsmanagerPromptDismissed),
         modGroups: modGroupSettingsSchema.catch(defaults.app.modGroups)
      })
      .catch(defaults.app);
   const library = z
      .object({
         installRoot: z.string().trim().min(1).catch(defaults.library.installRoot),
         sharedRoot: z.union([z.string().trim().min(1), z.null()]).catch(defaults.library.sharedRoot),
         sharedRoots: z.array(z.string().trim().min(1)).catch(defaults.library.sharedRoots),
         protonPath: z.union([z.string().trim().min(1), z.null()]).catch(defaults.library.protonPath),
         useSymlinks: z.boolean().catch(defaults.library.useSymlinks),
         lastLaunch: launchRecordSchema.nullable().catch(defaults.library.lastLaunch)
      })
      .catch(defaults.library);

   return z.object({ app, library }).catch(defaults);
}
