import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';
import { writeJsonFileAtomic } from '@/lib/filesystem/json';
import { createDefaultInstallRoot } from '@/modules/installs/main/install-root';
import {
   applyAppSettingsPatch,
   applyLibrarySettingsPatch,
   createDefaultAppSettings,
   createDefaultLibrarySettings,
   type AppSettings,
   type AppSettingsPatch,
   type LibrarySettings,
   type LibrarySettingsPatch,
   type SettingsDiagnostics,
   type SettingsProblem,
   type SettingsSnapshot
} from '@/modules/settings/contract';
import type { SettingsWriteResult } from '@/modules/settings/ipc';
import { createRecoverableStoredSettingsFileSchema, storedSettingsFileSchema, type StoredSettingsFile } from '@/modules/settings/main/settings-file';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const settingsFileName = 'settings.json';

type SettingsStoreOptions = {
   dataPath: string;
   appVersion: string;
   platform: NodeJS.Platform;
   arch: string;
};

type LoadedSettings = {
   app: AppSettings;
   library: LibrarySettings;
   problem?: SettingsProblem;
};

type SettingsListener = (snapshot: SettingsSnapshot) => void;

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(options: SettingsStoreOptions) {
   const settingsPath = join(options.dataPath, settingsFileName);
   const defaultInstallRoot = createDefaultInstallRoot({
      platform: options.platform,
      userDataPath: options.dataPath
   });
   let loadedSettings: Promise<LoadedSettings> | null = null;
   let writeQueue = Promise.resolve();
   const listeners = new Set<SettingsListener>();

   async function getSnapshot() {
      const settings = await loadSettings();
      return createSnapshot(settings);
   }

   async function updateAppSettings(patch: AppSettingsPatch | ((current: AppSettings) => AppSettingsPatch)) {
      return enqueueWrite(async () => {
         const settings = await loadSettings();
         const nextSettings: LoadedSettings = {
            app: applyAppSettingsPatch(settings.app, typeof patch === 'function' ? patch(settings.app) : patch),
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

   function loadSettings(): Promise<LoadedSettings> {
      loadedSettings ??= readSettings();
      return loadedSettings;
   }

   async function readSettings(): Promise<LoadedSettings> {
      const readResult = await Result.tryPromise({
         try: () => readFile(settingsPath, 'utf8'),
         catch: (cause) => createSettingsProblem('settings.read.failed', 'failed to read settings', causeCode(cause))
      });

      if (Result.isError(readResult)) {
         return createDefaultSettings(readResult.error.detail === 'ENOENT' ? undefined : readResult.error);
      }

      const settings = parseSettingsFile(readResult.value);
      return settings;
   }

   async function writeSettings(settings: LoadedSettings): Promise<SettingsWriteResult> {
      const file: StoredSettingsFile = {
         app: settings.app,
         library: settings.library
      };
      const writeResult = await writeJsonFileAtomic(settingsPath, file, storedSettingsFileSchema, {
         root: options.dataPath,
         scope: 'settings'
      });

      if (Result.isError(writeResult)) {
         const problem = createSettingsProblem('settings.write.failed', 'failed to write settings', writeResult.error.detail);

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

      loadedSettings = Promise.resolve(settings);
      const snapshot = createSnapshot(settings);
      emit(snapshot);

      return {
         ok: true,
         value: snapshot
      };
   }

   function parseSettingsFile(contents: string): LoadedSettings {
      const parseResult = Result.try({
         try: (): unknown => JSON.parse(contents),
         catch: (cause) => createSettingsProblem('settings.read.corrupt', 'settings file contains invalid JSON', causeCode(cause))
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

      const defaults = {
         app: createDefaultAppSettings(),
         library: createDefaultLibrarySettings(defaultInstallRoot)
      };
      const recovered = createRecoverableStoredSettingsFileSchema(defaults).parse(parseResult.value);

      return {
         app: recovered.app,
         library: recovered.library,
         problem: createSettingsProblem('settings.read.invalid', 'settings file contained invalid values', parsed.error.message)
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

   function createSettingsProblem(code: SettingsProblem['code'], message: string, detail?: string): SettingsProblem {
      return {
         code,
         message,
         path: settingsPath,
         ...(detail ? { detail } : {})
      };
   }

   function subscribe(listener: SettingsListener) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   function emit(snapshot: SettingsSnapshot) {
      for (const listener of listeners) {
         listener(snapshot);
      }
   }

   return {
      getSnapshot,
      updateAppSettings,
      updateLibrarySettings,
      subscribe
   };
}
