import { z } from 'zod';

import { launchOptionsSchema, launchRecordSchema } from '@/modules/launch/contract';
import { defaultModSourceResolutionSettings, modRepositoryRecordSchema, modSourceResolutionSettingsSchema } from '@/modules/mods/contract';
import { customSharedFolderSchema } from '@/modules/shared-content/contract';
import { localTargetId } from '@/modules/targets/contract';
import { defaultLocale, localeSchema } from '@/renderer/i18n/config';

export const defaultAccentColor = '#59b0f4';
export const accentColorSchema = z
   .string()
   .regex(/^#[0-9a-f]{6}$/i)
   .transform((value) => value.toLowerCase());

export const themeSchema = z.enum(['light', 'dark', 'system']);
export const themes = themeSchema.options;

export type Theme = z.infer<typeof themeSchema>;
export type ResolvedTheme = 'light' | 'dark';

export const pairedDeviceSchema = z.object({
   id: z.string(),
   name: z.string(),
   tokenHash: z.string(),
   pairedAt: z.string(),
   lastSeenAt: z.string().optional()
});

export const remoteTargetRecordSchema = z.object({
   id: z.string(),
   name: z.string(),
   host: z.string(),
   port: z.int().positive(),
   fingerprint: z.string(),
   certificatePem: z.string(),
   pairedAt: z.string(),
   lastConnectedAt: z.string().optional()
});

export const receiverSettingsSchema = z.object({
   enabled: z.boolean(),
   interfaceName: z.string().nullable(),
   pairedDevices: z.array(pairedDeviceSchema),
   remoteTargets: z.array(remoteTargetRecordSchema)
});

export const selectionSettingsSchema = z.object({
   targetId: z.string().trim().min(1),
   installIds: z.record(z.string().trim().min(1), z.string().trim().min(1))
});

export const modGroupSettingsSchema = z.object({
   order: z.array(z.string().trim().min(1)),
   collapsed: z.array(z.string().trim().min(1))
});

export function createDefaultModGroupSettings() {
   return { order: [], collapsed: ['category:library'] };
}

export const appSettingsSchema = z.object({
   theme: themeSchema,
   accentColor: accentColorSchema,
   locale: localeSchema,
   selection: selectionSettingsSchema,
   receiver: receiverSettingsSchema,
   modRepositories: z.array(modRepositoryRecordSchema),
   officialModSourceEnabled: z.boolean().default(true),
   scoreSaberModSourceEnabled: z.boolean().default(true),
   modSourceResolution: modSourceResolutionSettingsSchema.default(defaultModSourceResolutionSettings),
   alphaWarningAccepted: z.boolean().default(false),
   bsmanagerPromptDismissed: z.boolean().default(false),
   modGroups: modGroupSettingsSchema.default(createDefaultModGroupSettings())
});

export const librarySettingsSchema = z.object({
   installRoot: z.string().trim().min(1),
   sharedRoot: z.string().trim().min(1).nullable(),
   // other shared content roots installs may stay linked to (the active one lives in sharedRoot)
   sharedRoots: z.array(z.string().trim().min(1)).default([]),
   customFolders: z.array(customSharedFolderSchema).default([]),
   protonPath: z.string().trim().min(1).nullable(),
   useSymlinks: z.boolean().default(false),
   launchOptions: z.record(z.string().min(1), launchOptionsSchema).default({}),
   lastLaunch: launchRecordSchema.nullable()
});

export const appSettingsPatchSchema = z.object({
   theme: themeSchema.optional(),
   accentColor: accentColorSchema.optional(),
   locale: localeSchema.optional(),
   selection: selectionSettingsSchema.partial().optional(),
   receiver: receiverSettingsSchema.partial().optional(),
   modRepositories: z.array(modRepositoryRecordSchema).optional(),
   officialModSourceEnabled: z.boolean().optional(),
   scoreSaberModSourceEnabled: z.boolean().optional(),
   modSourceResolution: modSourceResolutionSettingsSchema.optional(),
   alphaWarningAccepted: z.boolean().optional(),
   bsmanagerPromptDismissed: z.boolean().optional(),
   modGroups: modGroupSettingsSchema.optional()
});

export const librarySettingsPatchSchema = z.object({
   installRoot: z.string().trim().min(1).optional(),
   sharedRoot: z.union([z.string().trim().min(1), z.null()]).optional(),
   sharedRoots: z.array(z.string().trim().min(1)).optional(),
   customFolders: z.array(customSharedFolderSchema).optional(),
   protonPath: z.union([z.string().trim().min(1), z.null()]).optional(),
   useSymlinks: z.boolean().optional(),
   launchOptions: z.record(z.string().min(1), launchOptionsSchema).optional(),
   lastLaunch: launchRecordSchema.nullable().optional()
});

export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type RemoteTargetRecord = z.infer<typeof remoteTargetRecordSchema>;
export type ReceiverSettings = z.infer<typeof receiverSettingsSchema>;
export type ModGroupSettings = z.infer<typeof modGroupSettingsSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type LibrarySettings = z.infer<typeof librarySettingsSchema>;
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;
export type LibrarySettingsPatch = z.infer<typeof librarySettingsPatchSchema>;
export type SettingsProblem = {
   code: 'settings.read.corrupt' | 'settings.read.failed' | 'settings.read.invalid' | 'settings.write.failed';
   message: string;
   path: string;
   detail?: string;
};

export type SettingsDiagnostics = {
   platform: NodeJS.Platform;
   arch: string;
   appVersion: string;
   dataPath: string;
   settingsPath: string;
   installRoot: string;
   receiverEnabled: boolean;
};

export type SettingsSnapshot = {
   status: 'ready' | 'recovered';
   app: AppSettings;
   library: LibrarySettings;
   diagnostics: SettingsDiagnostics;
   problem?: SettingsProblem;
};

export function createDefaultAppSettings(): AppSettings {
   return {
      theme: 'system',
      accentColor: defaultAccentColor,
      locale: defaultLocale,
      selection: {
         targetId: localTargetId,
         installIds: {}
      },
      receiver: {
         enabled: false,
         interfaceName: null,
         pairedDevices: [],
         remoteTargets: []
      },
      modRepositories: [],
      officialModSourceEnabled: true,
      scoreSaberModSourceEnabled: true,
      modSourceResolution: defaultModSourceResolutionSettings,
      alphaWarningAccepted: false,
      bsmanagerPromptDismissed: false,
      modGroups: createDefaultModGroupSettings()
   };
}

export function createDefaultLibrarySettings(installRoot: string): LibrarySettings {
   return {
      installRoot,
      sharedRoot: null,
      sharedRoots: [],
      customFolders: [],
      protonPath: null,
      useSymlinks: false,
      launchOptions: {},
      lastLaunch: null
   };
}

export function applyAppSettingsPatch(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
   return {
      theme: patch.theme ?? settings.theme,
      accentColor: patch.accentColor ?? settings.accentColor,
      locale: patch.locale ?? settings.locale,
      selection: {
         targetId: patch.selection?.targetId ?? settings.selection.targetId,
         installIds: { ...settings.selection.installIds, ...patch.selection?.installIds }
      },
      receiver: {
         enabled: patch.receiver?.enabled ?? settings.receiver.enabled,
         interfaceName: patch.receiver?.interfaceName === undefined ? settings.receiver.interfaceName : patch.receiver.interfaceName,
         pairedDevices: patch.receiver?.pairedDevices ?? settings.receiver.pairedDevices,
         remoteTargets: patch.receiver?.remoteTargets ?? settings.receiver.remoteTargets
      },
      modRepositories: patch.modRepositories ?? settings.modRepositories,
      officialModSourceEnabled: patch.officialModSourceEnabled ?? settings.officialModSourceEnabled,
      scoreSaberModSourceEnabled: patch.scoreSaberModSourceEnabled ?? settings.scoreSaberModSourceEnabled,
      modSourceResolution: patch.modSourceResolution ?? settings.modSourceResolution,
      alphaWarningAccepted: patch.alphaWarningAccepted ?? settings.alphaWarningAccepted,
      bsmanagerPromptDismissed: patch.bsmanagerPromptDismissed ?? settings.bsmanagerPromptDismissed,
      modGroups: patch.modGroups ?? settings.modGroups
   };
}

export function applyLibrarySettingsPatch(settings: LibrarySettings, patch: LibrarySettingsPatch): LibrarySettings {
   return {
      installRoot: patch.installRoot ?? settings.installRoot,
      sharedRoot: patch.sharedRoot === undefined ? settings.sharedRoot : patch.sharedRoot,
      sharedRoots: patch.sharedRoots ?? settings.sharedRoots,
      customFolders: patch.customFolders ?? settings.customFolders,
      protonPath: patch.protonPath === undefined ? settings.protonPath : patch.protonPath,
      useSymlinks: patch.useSymlinks ?? settings.useSymlinks,
      launchOptions: { ...settings.launchOptions, ...patch.launchOptions },
      lastLaunch: patch.lastLaunch === undefined ? settings.lastLaunch : patch.lastLaunch
   };
}
