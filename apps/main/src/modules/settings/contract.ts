import { z } from 'zod';

import { installIdSchema } from '@/modules/installs/contract';
import { launchOptionsSchema, launchRecordSchema } from '@/modules/launch/contract';
import { defaultModSourceResolutionSettings, modRepositoryRecordSchema, modSourceResolutionSettingsSchema } from '@/modules/mods/contract';
import { defaultReceiverPort, receiverBindHostSchema, receiverPortSchema } from '@/modules/receiver/address';
import { customSharedFolderSchema } from '@/modules/shared-content/contract';
import { localTargetId, targetIdSchema } from '@/modules/targets/contract';
import { defaultLocale, localeSchema } from '@/renderer/i18n/config';

export const defaultAccentColor = '#59b0f4';
export const accentColorSchema = z
   .string()
   .regex(/^#[0-9a-f]{6}$/i)
   .transform((value) => value.toLowerCase());

export const themeSchema = z.enum(['light', 'dark', 'system']);
const setupChoiceSchema = z.enum(['pc', 'quest', 'both']);
export const themes = themeSchema.options;

export type SetupChoice = z.infer<typeof setupChoiceSchema>;
export type ResolvedTheme = 'light' | 'dark';

const pairedDeviceSchema = z.object({
   id: z.string(),
   name: z.string(),
   tokenHash: z.string(),
   pairedAt: z.string(),
   lastSeenAt: z.string().optional()
});

const remoteTargetRecordSchema = z.object({
   id: z.string(),
   name: z.string(),
   host: z.string(),
   port: z.int().positive(),
   fingerprint: z.string(),
   certificatePem: z.string(),
   pairedAt: z.string(),
   lastConnectedAt: z.string().optional()
});

const receiverSettingsSchema = z.object({
   enabled: z.boolean(),
   interfaceName: z.string().nullable(),
   bindHost: receiverBindHostSchema.nullable(),
   port: receiverPortSchema,
   pairedDevices: z.array(pairedDeviceSchema),
   remoteTargets: z.array(remoteTargetRecordSchema)
});

const selectionSettingsSchema = z.object({
   targetId: z.string().trim().min(1),
   installIds: z.record(z.string().trim().min(1), z.string().trim().min(1))
});

const modGroupSettingsSchema = z.object({
   order: z.array(z.string().trim().min(1)),
   collapsed: z.array(z.string().trim().min(1))
});

export function createDefaultModGroupSettings() {
   return { order: [], collapsed: ['category:library'] };
}

const linkDestinationSchema = z.object({
   targetId: targetIdSchema,
   installId: installIdSchema
});

const linkHandlingSettingsSchema = z.object({
   launchWithoutAsking: z.boolean(),
   downloadInstalls: z.array(linkDestinationSchema)
});

export const appSettingsSchema = z.object({
   theme: themeSchema,
   accentColor: accentColorSchema,
   locale: localeSchema,
   selection: selectionSettingsSchema,
   receiver: receiverSettingsSchema,
   modRepositories: z.array(modRepositoryRecordSchema),
   officialModSourceEnabled: z.boolean(),
   scoreSaberModSourceEnabled: z.boolean(),
   questModSourceEnabled: z.boolean(),
   modSourceResolution: modSourceResolutionSettingsSchema,
   alphaWarningAccepted: z.boolean(),
   setup: setupChoiceSchema.nullable(),
   telemetryEnabled: z.boolean(),
   runInBackground: z.boolean(),
   startAtLogin: z.boolean(),
   combineInstalls: z.boolean(),
   launchVia: z.record(z.string(), z.string()),
   dismissedHints: z.array(z.string()),
   modGroups: modGroupSettingsSchema,
   linkHandling: linkHandlingSettingsSchema
});

export const librarySettingsSchema = z.object({
   installRoot: z.string().trim().min(1),
   sharedRoot: z.string().trim().min(1).nullable(),
   // other shared content roots installs may stay linked to (the active one lives in sharedRoot)
   sharedRoots: z.array(z.string().trim().min(1)),
   customFolders: z.array(customSharedFolderSchema),
   protonPath: z.string().trim().min(1).nullable(),
   useSymlinks: z.boolean(),
   launchOptions: z.record(z.string().min(1), launchOptionsSchema),
   lastLaunch: launchRecordSchema.nullable(),
   mirrors: z.array(z.object({ targetId: z.string(), installId: z.string(), path: z.string() }))
});

export const appSettingsPatchSchema = appSettingsSchema.partial().extend({
   selection: selectionSettingsSchema.partial().optional(),
   receiver: receiverSettingsSchema.partial().optional(),
   linkHandling: linkHandlingSettingsSchema.partial().optional()
});

export const librarySettingsPatchSchema = librarySettingsSchema.partial();

export type PairedDevice = z.infer<typeof pairedDeviceSchema>;
export type RemoteTargetRecord = z.infer<typeof remoteTargetRecordSchema>;
export type ReceiverSettings = z.infer<typeof receiverSettingsSchema>;
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
         bindHost: null,
         port: defaultReceiverPort,
         pairedDevices: [],
         remoteTargets: []
      },
      modRepositories: [],
      officialModSourceEnabled: true,
      scoreSaberModSourceEnabled: true,
      questModSourceEnabled: true,
      modSourceResolution: defaultModSourceResolutionSettings,
      alphaWarningAccepted: false,
      setup: null,
      telemetryEnabled: true,
      runInBackground: true,
      startAtLogin: false,
      combineInstalls: false,
      launchVia: {},
      dismissedHints: [],
      modGroups: createDefaultModGroupSettings(),
      linkHandling: { launchWithoutAsking: false, downloadInstalls: [] }
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
      lastLaunch: null,
      mirrors: []
   };
}

export function applyAppSettingsPatch(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
   return {
      ...settings,
      ...patch,
      selection: {
         ...settings.selection,
         ...patch.selection,
         installIds: { ...settings.selection.installIds, ...patch.selection?.installIds }
      },
      receiver: { ...settings.receiver, ...patch.receiver },
      linkHandling: { ...settings.linkHandling, ...patch.linkHandling }
   };
}

export function applyLibrarySettingsPatch(settings: LibrarySettings, patch: LibrarySettingsPatch): LibrarySettings {
   return { ...settings, ...patch, launchOptions: { ...settings.launchOptions, ...patch.launchOptions } };
}
