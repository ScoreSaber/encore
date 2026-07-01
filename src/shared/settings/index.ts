import type { Locale } from '@/i18n/config';
import { defaultLocale } from '@/i18n/config';
import type { Theme } from '@/shared/ui-adjacent/theme';

export const settingsSchemaVersion = 1;
export const storeKinds = ['steam', 'oculus'] as const;

export type StoreKind = (typeof storeKinds)[number];
export type SettingsRecoveryStatus = 'ready' | 'recovered';
export type SettingsPlatform = NodeJS.Platform | 'browser';

export type PairedDevice = {
   id: string;
   name: string;
   pairedAt: string;
   lastSeenAt?: string;
};

export type ReceiverSettings = {
   enabled: boolean;
   pairedDevices: PairedDevice[];
};

export type AppSettings = {
   theme: Theme;
   locale: Locale;
   receiver: ReceiverSettings;
};

export type LibrarySettings = {
   installRoot: string;
   defaultStore: StoreKind | null;
   protonPath: string | null;
};

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

export type AppSettingsPatch = {
   theme?: Theme;
   locale?: Locale;
   receiver?: Partial<ReceiverSettings>;
};

export type LibrarySettingsPatch = {
   installRoot?: string;
   defaultStore?: StoreKind | null;
   protonPath?: string | null;
};

export type StoredSettingsFile = {
   schemaVersion: typeof settingsSchemaVersion;
   app: AppSettings;
   library: LibrarySettings;
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

export function isStoreKind(value: unknown): value is StoreKind {
   for (const storeKind of storeKinds) {
      if (value === storeKind) return true;
   }

   return false;
}
