import { Result } from 'better-result';

import { createDefaultInstallRoot } from '@/main/filesystem/install-root';
import { writeJsonFileAtomic } from '@/main/filesystem/safe-json';
import type { SettingsWriteResult } from '@/shared/ipc/modules/settings';
import {
   applyAppSettingsPatch,
   applyLibrarySettingsPatch,
   createDefaultAppSettings,
   createDefaultLibrarySettings,
   createDefaultStoredSettingsFile,
   createRecoverableStoredSettingsFileSchema,
   settingsSchemaVersion,
   storedSettingsFileSchema,
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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const settingsFileName = 'settings.json';

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
   const defaultInstallRoot = createDefaultInstallRoot({
      platform: options.platform,
      userDataPath: options.dataPath
   });
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

   async function writeSettings(settings: LoadedSettings): Promise<SettingsWriteResult> {
      const file: StoredSettingsFile = {
         schemaVersion: settingsSchemaVersion,
         app: settings.app,
         library: settings.library
      };
      const writeResult = await writeJsonFileAtomic(settingsPath, file, storedSettingsFileSchema, {
         root: options.dataPath,
         scope: 'settings'
      });

      if (Result.isError(writeResult)) {
         const problem = createSettingsProblem('settings.write.failed', 'failed to write settings', writeResult.error);

         return {
            ok: false,
            error: {
               code: problem.code,
               message: problem.message,
               details: {
                  path: problem.path,
                  detail: problem.detail ?? null
               }
            }
         };
      }

      loadedSettings = settings;

      return {
         ok: true,
         value: createSnapshot(settings)
      };
   }

   function parseSettingsFile(contents: string): LoadedSettings {
      const parseResult = Result.try({
         try: (): unknown => JSON.parse(contents),
         catch: (cause) => createSettingsProblem('settings.read.corrupt', 'settings file contains invalid JSON', cause)
      });

      if (Result.isError(parseResult)) {
         return createDefaultSettings(parseResult.error);
      }

      const parsed = storedSettingsFileSchema.safeParse(parseResult.value);
      if (parsed.success) {
         return {
            app: parsed.data.app,
            library: parsed.data.library
         };
      }

      const recovered = createRecoverableStoredSettingsFileSchema(createDefaultStoredSettingsFile(defaultInstallRoot)).parse(parseResult.value);

      return {
         app: recovered.app,
         library: recovered.library,
         problem: createSettingsProblem('settings.read.invalid', 'settings file contained invalid values', parsed.error)
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

function isMissingFile(problem: SettingsProblem) {
   return problem.detail === 'ENOENT';
}

function errorDetail(cause: unknown) {
   if (cause && typeof cause === 'object' && 'detail' in cause && typeof cause.detail === 'string') return cause.detail;
   if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') return cause.code;
   if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') return cause.code;
   if (cause instanceof Error) return cause.message;
   return String(cause);
}
