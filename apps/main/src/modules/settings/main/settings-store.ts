import { Result } from 'better-result';
import { z } from 'zod';

import { createProblem } from '@/lib/errors';
import { writeJsonFileAtomic } from '@/lib/filesystem/json';
import { createSerialQueue } from '@/lib/state/machine';
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
import { readStoredSettings, storedSettingsFileSchema, type StoredSettingsFile } from '@/modules/settings/main/settings-file';

import { constants, copyFile, readFile } from 'node:fs/promises';
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
   let corruptBackedUp = false;
   const writeQueue = createSerialQueue();
   const listeners = new Set<SettingsListener>();

   async function getSnapshot() {
      const settings = await loadSettings();
      return createSnapshot(settings);
   }

   async function updateAppSettingsWith(update: (current: AppSettings) => AppSettingsPatch) {
      return writeQueue.run(async () => {
         const settings = await loadSettings();
         const nextSettings: LoadedSettings = {
            app: applyAppSettingsPatch(settings.app, update(settings.app)),
            library: settings.library
         };

         return writeSettings(nextSettings);
      });
   }

   async function updateLibrarySettingsWith(update: (current: LibrarySettings) => LibrarySettingsPatch) {
      return writeQueue.run(async () => {
         const settings = await loadSettings();
         const nextSettings: LoadedSettings = {
            app: settings.app,
            library: applyLibrarySettingsPatch(settings.library, update(settings.library))
         };

         return writeSettings(nextSettings);
      });
   }

   function loadSettings(): Promise<LoadedSettings> {
      loadedSettings ??= readSettings();
      return loadedSettings;
   }

   async function readSettings(): Promise<LoadedSettings> {
      const readResult = await Result.tryPromise({
         try: () => readFile(settingsPath, 'utf8'),
         catch: (cause) => createProblem('settings.read.failed', { path: settingsPath, cause })
      });

      if (Result.isError(readResult)) {
         return createDefaultSettings(readResult.error.detail === 'ENOENT' ? undefined : readResult.error);
      }

      return parseSettingsFile(readResult.value);
   }

   async function writeSettings(settings: LoadedSettings): Promise<SettingsWriteResult> {
      const kept = await keepUnreadableSettings();
      if (Result.isError(kept)) return { ok: false, error: kept.error };

      const file: StoredSettingsFile = {
         app: settings.app,
         library: settings.library
      };
      const writeResult = await writeJsonFileAtomic(settingsPath, file, storedSettingsFileSchema, {
         root: options.dataPath
      });

      if (Result.isError(writeResult)) {
         return { ok: false, error: createProblem('settings.write.failed', { path: settingsPath, detail: writeResult.error.detail }) };
      }

      loadedSettings = Promise.resolve(settings);
      corruptBackedUp = false;
      const snapshot = createSnapshot(settings);
      emit(snapshot);

      return {
         ok: true,
         value: snapshot
      };
   }

   async function keepUnreadableSettings() {
      if (corruptBackedUp || !(await loadSettings()).problem) return Result.ok();

      const backupPath = join(options.dataPath, `settings.invalid-${Date.now()}.json`);
      const copied = await Result.tryPromise({
         try: () => copyFile(settingsPath, backupPath, constants.COPYFILE_EXCL),
         catch: (cause) => createProblem('settings.write.failed', { path: backupPath, cause })
      });
      if (Result.isOk(copied)) corruptBackedUp = true;
      return copied;
   }

   function parseSettingsFile(contents: string): LoadedSettings {
      const parseResult = Result.try({
         try: () => z.json().parse(JSON.parse(contents)),
         catch: (cause) => createProblem('settings.read.corrupt', { path: settingsPath, cause })
      });

      if (Result.isError(parseResult)) {
         return createDefaultSettings(parseResult.error);
      }

      const read = readStoredSettings(parseResult.value, createDefaultSettings());
      if (read.invalidFields.length === 0) return read.settings;

      return {
         ...read.settings,
         problem: createProblem('settings.read.invalid', { path: settingsPath, detail: read.invalidFields.join(', ') })
      };
   }

   function createSnapshot(settings: LoadedSettings): SettingsSnapshot {
      const snapshot: SettingsSnapshot = {
         status: settings.problem ? 'recovered' : 'ready',
         app: settings.app,
         library: settings.library,
         diagnostics: createDiagnostics(settings)
      };
      if (settings.problem) snapshot.problem = settings.problem;
      return snapshot;
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
      const settings: LoadedSettings = { app: createDefaultAppSettings(), library: createDefaultLibrarySettings(defaultInstallRoot) };
      if (problem) settings.problem = problem;
      return settings;
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
      updateAppSettings: (patch: AppSettingsPatch) => updateAppSettingsWith(() => patch),
      updateAppSettingsWith,
      updateLibrarySettings: (patch: LibrarySettingsPatch) => updateLibrarySettingsWith(() => patch),
      updateLibrarySettingsWith,
      subscribe
   };
}
