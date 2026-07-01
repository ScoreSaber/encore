import { Result } from 'better-result';

import { parseLocale } from '@/i18n/config';
import {
   createDefaultAppSettings,
   createDefaultLibrarySettings,
   isStoreKind,
   settingsSchemaVersion,
   type AppSettings,
   type AppSettingsPatch,
   type LibrarySettings,
   type LibrarySettingsPatch,
   type SettingsDiagnostics,
   type SettingsPlatform,
   type SettingsProblem,
   type SettingsSnapshot,
   type StoredSettingsFile
} from '@/shared/settings';
import { parseTheme } from '@/shared/ui-adjacent/theme';

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const settingsFileName = 'settings.json';
const defaultLibraryDirectoryName = 'library';

type SettingsStoreOptions = {
   dataPath: string;
   appVersion: string;
   platform: SettingsPlatform;
   arch: string;
};

type LoadedSettings = {
   app: AppSettings;
   library: LibrarySettings;
   problem?: SettingsProblem;
};

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(options: SettingsStoreOptions) {
   const settingsPath = join(options.dataPath, settingsFileName);
   const defaultInstallRoot = join(options.dataPath, defaultLibraryDirectoryName);
   let loadedSettings: LoadedSettings | null = null;
   let writeQueue = Promise.resolve();

   async function getSnapshot() {
      const settings = await loadSettings();
      return createSnapshot(settings);
   }

   async function updateAppSettings(patch: AppSettingsPatch) {
      return enqueueWrite(async () => {
         const settings = await loadSettings();
         const nextSettings: LoadedSettings = {
            app: applyAppSettingsPatch(settings.app, patch),
            library: settings.library
         };

         return writeSettings(nextSettings);
      });
   }

   async function updateLibrarySettings(patch: LibrarySettingsPatch) {
      return enqueueWrite(async () => {
         const settings = await loadSettings();
         const nextSettings: LoadedSettings = {
            app: settings.app,
            library: applyLibrarySettingsPatch(settings.library, patch)
         };

         return writeSettings(nextSettings);
      });
   }

   async function enqueueWrite(task: () => Promise<Awaited<ReturnType<typeof writeSettings>>>) {
      const writeTask = writeQueue.then(task);
      writeQueue = writeTask.then(
         () => {},
         () => {}
      );

      return writeTask;
   }

   async function loadSettings(): Promise<LoadedSettings> {
      if (loadedSettings) return loadedSettings;

      const readResult = await Result.tryPromise({
         try: () => readFile(settingsPath, 'utf8'),
         catch: (cause) => createSettingsProblem('settings.read.failed', 'failed to read settings', cause)
      });

      if (Result.isError(readResult)) {
         loadedSettings = createDefaultSettings(isMissingFile(readResult.error) ? undefined : readResult.error);
         return loadedSettings;
      }

      loadedSettings = parseSettingsFile(readResult.value);
      return loadedSettings;
   }

   async function writeSettings(settings: LoadedSettings) {
      const writeResult = await Result.tryPromise({
         try: async () => {
            const file: StoredSettingsFile = {
               schemaVersion: settingsSchemaVersion,
               app: settings.app,
               library: settings.library
            };
            const temporaryPath = `${settingsPath}.tmp`;

            await mkdir(options.dataPath, { recursive: true });
            await writeFile(temporaryPath, `${JSON.stringify(file, null, 3)}\n`, 'utf8');
            await rename(temporaryPath, settingsPath);
         },
         catch: (cause) => createSettingsProblem('settings.write.failed', 'failed to write settings', cause)
      });

      if (Result.isError(writeResult)) {
         return {
            ok: false,
            error: {
               code: writeResult.error.code,
               message: writeResult.error.message,
               details: {
                  path: writeResult.error.path,
                  detail: writeResult.error.detail ?? null
               }
            }
         } as const;
      }

      loadedSettings = settings;

      return {
         ok: true,
         value: createSnapshot(settings)
      } as const;
   }

   function parseSettingsFile(contents: string): LoadedSettings {
      const parseResult = Result.try({
         try: () => JSON.parse(contents) as unknown,
         catch: (cause) => createSettingsProblem('settings.read.corrupt', 'settings file contains invalid JSON', cause)
      });

      if (Result.isError(parseResult)) {
         return createDefaultSettings(parseResult.error);
      }

      const parsed = parseSettingsValue(parseResult.value);

      if (parsed.invalid) {
         return {
            ...parsed.settings,
            problem: createSettingsProblem('settings.read.invalid', 'settings file contained invalid values')
         };
      }

      return parsed.settings;
   }

   function parseSettingsValue(value: unknown) {
      const record = asRecord(value);
      if (!record || record.schemaVersion !== settingsSchemaVersion) {
         return {
            invalid: true,
            settings: createDefaultSettings()
         };
      }

      const parsedApp = parseStoredAppSettings(record.app);
      const parsedLibrary = parseStoredLibrarySettings(record.library);

      return {
         invalid: parsedApp.invalid || parsedLibrary.invalid,
         settings: {
            app: parsedApp.settings,
            library: parsedLibrary.settings
         }
      };
   }

   function parseStoredAppSettings(value: unknown) {
      const fallback = createDefaultAppSettings();
      const record = asRecord(value);
      if (!record) {
         return {
            invalid: true,
            settings: fallback
         };
      }

      const receiver = asRecord(record.receiver);
      const pairedDevices = receiver ? parsePairedDevices(receiver.pairedDevices) : { invalid: true, devices: fallback.receiver.pairedDevices };
      const theme = typeof record.theme === 'string' ? parseTheme(record.theme) : fallback.theme;
      const locale = typeof record.locale === 'string' ? parseLocale(record.locale) : fallback.locale;

      return {
         invalid:
            typeof record.theme !== 'string' ||
            typeof record.locale !== 'string' ||
            !receiver ||
            typeof receiver.enabled !== 'boolean' ||
            pairedDevices.invalid,
         settings: {
            theme,
            locale,
            receiver: {
               enabled: typeof receiver?.enabled === 'boolean' ? receiver.enabled : fallback.receiver.enabled,
               pairedDevices: pairedDevices.devices
            }
         }
      };
   }

   function parseStoredLibrarySettings(value: unknown) {
      const fallback = createDefaultLibrarySettings(defaultInstallRoot);
      const record = asRecord(value);
      if (!record) {
         return {
            invalid: true,
            settings: fallback
         };
      }

      return {
         invalid:
            typeof record.installRoot !== 'string' ||
            !pathOrNullIsValid(record.protonPath) ||
            !(record.defaultStore === null || isStoreKind(record.defaultStore)),
         settings: {
            installRoot: typeof record.installRoot === 'string' && record.installRoot.length > 0 ? record.installRoot : fallback.installRoot,
            defaultStore: isStoreKind(record.defaultStore) ? record.defaultStore : fallback.defaultStore,
            protonPath: typeof record.protonPath === 'string' && record.protonPath.length > 0 ? record.protonPath : fallback.protonPath
         }
      };
   }

   function createSnapshot(settings: LoadedSettings): SettingsSnapshot {
      return {
         status: settings.problem ? 'recovered' : 'ready',
         app: settings.app,
         library: settings.library,
         diagnostics: createDiagnostics(settings),
         ...(settings.problem ? { problem: settings.problem } : {})
      };
   }

   function createDiagnostics(settings: LoadedSettings): SettingsDiagnostics {
      return {
         platform: options.platform,
         arch: options.arch,
         appVersion: options.appVersion,
         dataPath: options.dataPath,
         settingsPath,
         installRoot: settings.library.installRoot,
         receiverEnabled: settings.app.receiver.enabled
      };
   }

   function createDefaultSettings(problem?: SettingsProblem): LoadedSettings {
      return {
         app: createDefaultAppSettings(),
         library: createDefaultLibrarySettings(defaultInstallRoot),
         ...(problem ? { problem } : {})
      };
   }

   function createSettingsProblem(code: SettingsProblem['code'], message: string, cause?: unknown): SettingsProblem {
      return {
         code,
         message,
         path: settingsPath,
         ...(cause ? { detail: errorDetail(cause) } : {})
      };
   }

   return {
      getSnapshot,
      updateAppSettings,
      updateLibrarySettings
   };
}

function applyAppSettingsPatch(settings: AppSettings, patch: AppSettingsPatch): AppSettings {
   return {
      theme: patch.theme ? parseTheme(patch.theme) : settings.theme,
      locale: patch.locale ? parseLocale(patch.locale) : settings.locale,
      receiver: {
         enabled: patch.receiver?.enabled ?? settings.receiver.enabled,
         pairedDevices: patch.receiver?.pairedDevices ?? settings.receiver.pairedDevices
      }
   };
}

function applyLibrarySettingsPatch(settings: LibrarySettings, patch: LibrarySettingsPatch): LibrarySettings {
   return {
      installRoot: patch.installRoot?.trim() || settings.installRoot,
      defaultStore: patch.defaultStore === undefined ? settings.defaultStore : patch.defaultStore,
      protonPath: patch.protonPath === undefined ? settings.protonPath : patch.protonPath?.trim() || null
   };
}

function parsePairedDevices(value: unknown) {
   if (!Array.isArray(value)) {
      return {
         invalid: true,
         devices: []
      };
   }

   const devices = [];
   let invalid = false;

   for (const item of value) {
      const record = asRecord(item);

      if (!record || typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.pairedAt !== 'string') {
         invalid = true;
         continue;
      }

      devices.push({
         id: record.id,
         name: record.name,
         pairedAt: record.pairedAt,
         ...(typeof record.lastSeenAt === 'string' ? { lastSeenAt: record.lastSeenAt } : {})
      });
   }

   return {
      invalid,
      devices
   };
}

function asRecord(value: unknown) {
   if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
   return value as Record<string, unknown>;
}

function pathOrNullIsValid(value: unknown) {
   return value === null || typeof value === 'string';
}

function isMissingFile(problem: SettingsProblem) {
   return problem.detail === 'ENOENT';
}

function errorDetail(cause: unknown) {
   if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') return cause.code;
   if (cause instanceof Error) return cause.message;
   return String(cause);
}
