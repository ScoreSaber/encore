import { z } from 'zod';

import { defaultLocale, localeSchema } from '@/i18n/config';
import { themeSchema } from '@/shared/ui-adjacent/theme';

export const settingsSchemaVersion = 1;
export const storeKindSchema = z.enum(['steam', 'oculus']);
export const storeKinds = storeKindSchema.options;

export const pairedDeviceSchema = z.object({
   id: z.string(),
   name: z.string(),
   pairedAt: z.string(),
   lastSeenAt: z.string().optional()
});

export const receiverSettingsSchema = z.object({
   enabled: z.boolean(),
   pairedDevices: z.array(pairedDeviceSchema)
});

export const appSettingsSchema = z.object({
   theme: themeSchema,
   locale: localeSchema,
   receiver: receiverSettingsSchema
});

export const librarySettingsSchema = z.object({
   installRoot: z.string().trim().min(1),
   defaultStore: storeKindSchema.nullable(),
   protonPath: z.string().trim().min(1).nullable()
});

export const storedSettingsFileSchema = z.object({
   schemaVersion: z.literal(settingsSchemaVersion),
   app: appSettingsSchema,
   library: librarySettingsSchema
});

export const appSettingsPatchSchema = z.object({
   theme: themeSchema.optional(),
   locale: localeSchema.optional(),
   receiver: receiverSettingsSchema.partial().optional()
});

export const librarySettingsPatchSchema = z.object({
   installRoot: z.string().trim().min(1).optional(),
   defaultStore: storeKindSchema.nullable().optional(),
   protonPath: z.union([z.string().trim().min(1), z.null()]).optional()
});
const emptyAppSettingsPatch = {};
const emptyLibrarySettingsPatch = {};

export type StoreKind = z.infer<typeof storeKindSchema>;
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type ReceiverSettings = z.infer<typeof receiverSettingsSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type LibrarySettings = z.infer<typeof librarySettingsSchema>;
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;
export type LibrarySettingsPatch = z.infer<typeof librarySettingsPatchSchema>;
export type StoredSettingsFile = z.infer<typeof storedSettingsFileSchema>;

export type SettingsRecoveryStatus = 'ready' | 'recovered';
export type SettingsPlatform = NodeJS.Platform | 'browser';

export type SettingsProblem = {
   code: 'settings.read.corrupt' | 'settings.read.failed' | 'settings.read.invalid' | 'settings.write.failed';
   message: string;
   path: string;
   detail?: string;
};

export type SettingsDiagnostics = {
   platform: SettingsPlatform;
   arch: string;
   appVersion: string;
   dataPath: string;
   settingsPath: string;
   installRoot: string;
   receiverEnabled: boolean;
};

export type SettingsSnapshot = {
   status: SettingsRecoveryStatus;
   app: AppSettings;
   library: LibrarySettings;
   diagnostics: SettingsDiagnostics;
   problem?: SettingsProblem;
};

export function createDefaultAppSettings(): AppSettings {
   return {
      theme: 'system',
      locale: defaultLocale,
      receiver: {
         enabled: false,
         pairedDevices: []
      }
   };
}

export function createDefaultLibrarySettings(installRoot: string): LibrarySettings {
   return {
      installRoot,
      defaultStore: null,
      protonPath: null
   };
}

export function createDefaultStoredSettingsFile(installRoot: string): StoredSettingsFile {
   return {
      schemaVersion: settingsSchemaVersion,
      app: createDefaultAppSettings(),
      library: createDefaultLibrarySettings(installRoot)
   };
}

export function createRecoverableStoredSettingsFileSchema(defaults: StoredSettingsFile) {
   const recoverableReceiverSettingsSchema = z
      .object({
         enabled: z.boolean().catch(defaults.app.receiver.enabled),
         pairedDevices: z.array(pairedDeviceSchema).catch(defaults.app.receiver.pairedDevices)
      })
      .catch(defaults.app.receiver);

   const recoverableAppSettingsSchema = z
      .object({
         theme: themeSchema.catch(defaults.app.theme),
         locale: localeSchema.catch(defaults.app.locale),
         receiver: recoverableReceiverSettingsSchema
      })
      .catch(defaults.app);

   const recoverableLibrarySettingsSchema = z
      .object({
         installRoot: z.string().trim().min(1).catch(defaults.library.installRoot),
         defaultStore: storeKindSchema.nullable().catch(defaults.library.defaultStore),
         protonPath: z.union([z.string().trim().min(1), z.null()]).catch(defaults.library.protonPath)
      })
      .catch(defaults.library);

   return z
      .object({
         schemaVersion: z.literal(settingsSchemaVersion).catch(settingsSchemaVersion),
         app: recoverableAppSettingsSchema,
         library: recoverableLibrarySettingsSchema
      })
      .catch(defaults);
}

export function applyAppSettingsPatch(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
   const nextPatch = appSettingsPatchSchema.catch(emptyAppSettingsPatch).parse(patch);

   return {
      theme: nextPatch.theme ?? settings.theme,
      locale: nextPatch.locale ?? settings.locale,
      receiver: {
         enabled: nextPatch.receiver?.enabled ?? settings.receiver.enabled,
         pairedDevices: nextPatch.receiver?.pairedDevices ?? settings.receiver.pairedDevices
      }
   };
}

export function applyLibrarySettingsPatch(settings: LibrarySettings, patch: LibrarySettingsPatch): LibrarySettings {
   const nextPatch = librarySettingsPatchSchema.catch(emptyLibrarySettingsPatch).parse(patch);

   return {
      installRoot: nextPatch.installRoot ?? settings.installRoot,
      defaultStore: nextPatch.defaultStore === undefined ? settings.defaultStore : nextPatch.defaultStore,
      protonPath: nextPatch.protonPath === undefined ? settings.protonPath : nextPatch.protonPath
   };
}
