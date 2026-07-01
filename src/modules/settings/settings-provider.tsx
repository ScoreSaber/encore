import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Result } from 'better-result';

import { LOCALE_STORAGE_KEY, parseLocale } from '@/i18n/config';
import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { IpcError } from '@/shared/ipc/core';
import type { SettingsWriteResult } from '@/shared/ipc/modules/settings';
import { readStorageValue, removeStorageValue, writeStorageValue } from '@/shared/result/storage';
import type { AppSettingsPatch, LibrarySettingsPatch, SettingsSnapshot } from '@/shared/settings';
import { parseTheme, THEME_STORAGE_KEY } from '@/shared/ui-adjacent/theme';

const localStorageMigrationKey = 'encore.settings.local-storage-migrated';
const savedStateResetMs = 1_500;

type SettingsLoadStatus = 'error' | 'loading' | 'ready';
type SettingsSaveStatus = 'error' | 'idle' | 'saved' | 'saving';

type SettingsContextValue = {
   snapshot: SettingsSnapshot | null;
   loadStatus: SettingsLoadStatus;
   saveStatus: SettingsSaveStatus;
   loadError: string | null;
   writeError: IpcError | null;
   reload: () => Promise<void>;
   updateApp: (patch: AppSettingsPatch) => Promise<SettingsWriteResult>;
   updateLibrary: (patch: LibrarySettingsPatch) => Promise<SettingsWriteResult>;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
   const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
   const [loadStatus, setLoadStatus] = useState<SettingsLoadStatus>('loading');
   const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle');
   const [loadError, setLoadError] = useState<string | null>(null);
   const [writeError, setWriteError] = useState<IpcError | null>(null);
   const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

   const clearSaveTimer = useCallback(() => {
      if (!resetTimer.current) return;
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
   }, []);

   const markSaved = useCallback(() => {
      clearSaveTimer();
      setSaveStatus('saved');
      resetTimer.current = setTimeout(() => {
         setSaveStatus('idle');
         resetTimer.current = null;
      }, savedStateResetMs);
   }, [clearSaveTimer]);

   const reload = useCallback(async () => {
      setLoadStatus('loading');
      setLoadError(null);

      const result = await Result.tryPromise({
         try: async () => migrateLegacyAppearance(await getEncoreApi().settings.getSnapshot()),
         catch: (cause) => errorMessage('failed to load settings', cause)
      });

      if (Result.isError(result)) {
         setLoadStatus('error');
         setLoadError(result.error);
         return;
      }

      setSnapshot(result.value);
      setLoadStatus('ready');
   }, []);

   const updateApp = useCallback(
      async (patch: AppSettingsPatch) => {
         clearSaveTimer();
         setSaveStatus('saving');
         setWriteError(null);

         const result = await safeWrite(() => getEncoreApi().settings.updateApp(patch));

         if (result.ok) {
            setSnapshot(result.value);
            markSaved();
            return result;
         }

         setSaveStatus('error');
         setWriteError(result.error);
         return result;
      },
      [clearSaveTimer, markSaved]
   );

   const updateLibrary = useCallback(
      async (patch: LibrarySettingsPatch) => {
         clearSaveTimer();
         setSaveStatus('saving');
         setWriteError(null);

         const result = await safeWrite(() => getEncoreApi().settings.updateLibrary(patch));

         if (result.ok) {
            setSnapshot(result.value);
            markSaved();
            return result;
         }

         setSaveStatus('error');
         setWriteError(result.error);
         return result;
      },
      [clearSaveTimer, markSaved]
   );

   useEffect(() => {
      void reload();
   }, [reload]);

   useEffect(() => {
      return () => clearSaveTimer();
   }, [clearSaveTimer]);

   const value = useMemo<SettingsContextValue>(
      () => ({
         snapshot,
         loadStatus,
         saveStatus,
         loadError,
         writeError,
         reload,
         updateApp,
         updateLibrary
      }),
      [snapshot, loadStatus, saveStatus, loadError, writeError, reload, updateApp, updateLibrary]
   );

   return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
   const ctx = useContext(SettingsContext);
   if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
   return ctx;
}

async function migrateLegacyAppearance(snapshot: SettingsSnapshot) {
   const patch = getLegacyAppearancePatch();
   if (!patch) return snapshot;

   if (!patch.theme && !patch.locale) {
      markLegacyMigrationComplete();
      return snapshot;
   }

   const result = await getEncoreApi().settings.updateApp(patch);
   if (!result.ok) return snapshot;

   markLegacyMigrationComplete();
   return result.value;
}

function getLegacyAppearancePatch(): AppSettingsPatch | null {
   if (Result.unwrapOr(readStorageValue(localStorageMigrationKey), null) === 'true') return null;

   const themeValue = Result.unwrapOr(readStorageValue(THEME_STORAGE_KEY), null);
   const localeValue = Result.unwrapOr(readStorageValue(LOCALE_STORAGE_KEY), null);

   return {
      ...(themeValue ? { theme: parseTheme(themeValue) } : {}),
      ...(localeValue ? { locale: parseLocale(localeValue) } : {})
   };
}

function markLegacyMigrationComplete() {
   writeStorageValue(localStorageMigrationKey, 'true');
   removeStorageValue(THEME_STORAGE_KEY);
   removeStorageValue(LOCALE_STORAGE_KEY);
}

async function safeWrite(write: () => Promise<SettingsWriteResult>): Promise<SettingsWriteResult> {
   const result = await Result.tryPromise({
      try: write,
      catch: (cause): IpcError => ({
         code: 'settings.ipc.failed',
         message: errorMessage('failed to save settings', cause)
      })
   });

   if (Result.isOk(result)) return result.value;

   return {
      ok: false,
      error: result.error
   };
}

function errorMessage(message: string, cause: unknown) {
   if (cause instanceof Error) return `${message}: ${cause.message}`;
   return `${message}: ${String(cause)}`;
}
