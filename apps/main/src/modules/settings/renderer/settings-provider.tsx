import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Result } from 'better-result';

import type { IpcError } from '@/ipc/core';
import { causeFailure } from '@/lib/errors';
import type { AppSettingsPatch, LibrarySettingsPatch, SettingsSnapshot } from '@/modules/settings/contract';
import type { SettingsWriteResult } from '@/modules/settings/ipc';
import { settingsSnapshotQueryOptions } from '@/modules/settings/renderer/settings-queries';

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
   const queryClient = useQueryClient();
   const options = settingsSnapshotQueryOptions;
   const settings = useQuery(options);
   const [saveStatus, setSaveStatus] = useState<SettingsSaveStatus>('idle');
   const [writeError, setWriteError] = useState<IpcError | null>(null);
   const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

   const clearSaveTimer = useCallback(() => {
      if (!resetTimer.current) return;
      clearTimeout(resetTimer.current);
      resetTimer.current = null;
   }, []);

   const write = useCallback(
      async (run: () => Promise<SettingsWriteResult>) => {
         clearSaveTimer();
         setSaveStatus('saving');
         setWriteError(null);

         const response = await Result.tryPromise({
            try: run,
            catch: (cause): IpcError => ({
               code: 'settings.ipc.failed',
               message: causeFailure('failed to save settings', cause)
            })
         });
         const result: SettingsWriteResult = Result.isOk(response) ? response.value : { ok: false, error: response.error };
         if (!result.ok) {
            setSaveStatus('error');
            setWriteError(result.error);
            return result;
         }

         queryClient.setQueryData(options.queryKey, result.value);
         setSaveStatus('saved');
         resetTimer.current = setTimeout(() => {
            setSaveStatus('idle');
            resetTimer.current = null;
         }, savedStateResetMs);

         return result;
      },
      [clearSaveTimer, options.queryKey, queryClient]
   );

   useEffect(() => {
      return () => clearSaveTimer();
   }, [clearSaveTimer]);

   const value = useMemo<SettingsContextValue>(
      () => ({
         snapshot: settings.data ?? null,
         loadStatus: settings.isError ? 'error' : settings.isPending ? 'loading' : 'ready',
         saveStatus,
         loadError: settings.error ? causeFailure('failed to load settings', settings.error) : null,
         writeError,
         reload: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
         updateApp: (patch) => write(() => window.encore.settings.updateApp(patch)),
         updateLibrary: (patch) => write(() => window.encore.settings.updateLibrary(patch))
      }),
      [settings.data, settings.error, settings.isError, settings.isPending, saveStatus, writeError, queryClient, options.queryKey, write]
   );

   return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
   const ctx = useContext(SettingsContext);
   if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
   return ctx;
}
