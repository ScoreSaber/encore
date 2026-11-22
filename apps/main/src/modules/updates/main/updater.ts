import { Result } from 'better-result';
import type { Logger, ProgressInfo } from 'electron-updater';

import { causeMessage } from '@/lib/errors';
import type { AppPackaging } from '@/modules/app/contract';
import type { AppLogWriter } from '@/modules/support/main/app-log';
import type { UpdateState } from '@/modules/updates/contract';

const initialCheckDelayMs = 3_000;
const checkIntervalMs = 5 * 60_000;
const quitDelayMs = 500;

type UpdateEngine = {
   checkForUpdates: () => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null>;
   downloadUpdate: () => Promise<string[]>;
   quitAndInstall: (isSilent: boolean, isForceRunAfter: boolean) => void;
   on: {
      (event: 'download-progress', listener: (progress: ProgressInfo) => void): void;
      (event: 'error', listener: (error: Error) => void): void;
   };
};

type UpdaterPhase =
   | { status: 'disabled'; reason: 'development' | 'system-managed' }
   | { status: 'idle' }
   | { status: 'checking'; pending: Promise<UpdateState> }
   | { status: 'up-to-date' }
   | { status: 'available'; version: string; downloadError: string | null }
   | { status: 'downloading'; version: string; percent: number }
   | { status: 'downloaded'; version: string; installError: string | null }
   | { status: 'installing'; version: string; installer: UpdateEngine; quitTimer: ReturnType<typeof setTimeout> }
   | { status: 'error'; message: string };

export function createUpdater(options: {
   version: string;
   packaging: AppPackaging;
   load: () => Promise<UpdateEngine>;
   quit: () => void;
   log: (message: string) => void;
}) {
   const listeners = new Set<(state: UpdateState) => void>();
   let engine: Promise<UpdateEngine> | null = null;
   let lastError: string | null = null;
   let initialTimer: ReturnType<typeof setTimeout> | null = null;
   let pollTimer: ReturnType<typeof setInterval> | null = null;
   let started = false;
   let disposed = false;

   let phase: UpdaterPhase = options.packaging.updateChecks
      ? { status: 'idle' }
      : { status: 'disabled', reason: options.packaging.packaged ? 'system-managed' : 'development' };
   let state: UpdateState = projectState(phase);

   function projectState(next: UpdaterPhase): UpdateState {
      const base: Omit<UpdateState, 'status'> = {
         currentVersion: options.version,
         availableVersion: null,
         downloadedVersion: null,
         downloadPercent: null,
         message: null,
         errorContext: null,
         selfUpdates: options.packaging.selfUpdates,
         disabledReason: null
      };

      switch (next.status) {
         case 'disabled':
            return { ...base, status: 'disabled', disabledReason: next.reason };
         case 'idle':
            return { ...base, status: 'idle' };
         case 'checking':
            return { ...base, status: 'checking' };
         case 'up-to-date':
            return { ...base, status: 'up-to-date' };
         case 'available':
            return {
               ...base,
               status: 'available',
               availableVersion: next.version,
               message: next.downloadError,
               errorContext: next.downloadError ? 'download' : null
            };
         case 'downloading':
            return {
               ...base,
               status: 'downloading',
               availableVersion: next.version,
               downloadPercent: next.percent
            };
         case 'downloaded':
            return {
               ...base,
               status: 'downloaded',
               availableVersion: next.version,
               downloadedVersion: next.version,
               downloadPercent: 100,
               message: next.installError,
               errorContext: next.installError ? 'install' : null
            };
         case 'installing':
            return {
               ...base,
               status: 'downloaded',
               availableVersion: next.version,
               downloadedVersion: next.version,
               downloadPercent: 100
            };
         case 'error':
            return {
               ...base,
               status: 'error',
               message: next.message,
               errorContext: 'check'
            };
      }
   }

   function load() {
      if (!engine) {
         const loading = options.load().then((loaded) => {
            loaded.on('download-progress', (progress) => {
               if (phase.status === 'downloading') {
                  transition({ ...phase, percent: Math.round(progress.percent) });
               }
            });
            loaded.on('error', (error) => {
               options.log(`error ${error.message}`);
               lastError = error.message;
            });
            return loaded;
         });
         engine = loading;
         void loading.then(
            () => undefined,
            () => {
               if (engine === loading) engine = null;
            }
         );
      }

      return engine;
   }

   function transition(nextPhase: UpdaterPhase) {
      const next = projectState(nextPhase);
      if (next.status !== state.status || next.message !== state.message) {
         options.log(
            `status=${next.status}${next.availableVersion ? ` version=${next.availableVersion}` : ''}${next.message ? ` message=${next.message}` : ''}`
         );
      }
      phase = nextPhase;
      state = next;
      for (const listener of listeners) listener(state);

      return state;
   }

   async function check() {
      if (disposed) return state;
      if (phase.status === 'checking') return phase.pending;
      if (phase.status === 'disabled' || phase.status === 'downloading' || phase.status === 'downloaded' || phase.status === 'installing') {
         return state;
      }

      const pending = (async () => {
         const checked = await Result.tryPromise({ try: async () => (await load()).checkForUpdates(), catch: causeMessage });
         if (disposed) return state;
         if (Result.isError(checked)) return transition({ status: 'error', message: checked.error });

         const found = checked.value?.isUpdateAvailable ? checked.value.updateInfo.version : null;
         return transition(found ? { status: 'available', version: found, downloadError: null } : { status: 'up-to-date' });
      })();

      transition({ status: 'checking', pending });
      return pending;
   }

   async function download() {
      if (disposed || phase.status !== 'available' || !options.packaging.selfUpdates) return state;

      const version = phase.version;
      transition({ status: 'downloading', version, percent: 0 });
      const downloaded = await Result.tryPromise({ try: async () => (await load()).downloadUpdate(), catch: causeMessage });
      if (disposed) return state;
      if (Result.isError(downloaded)) {
         return transition({ status: 'available', version, downloadError: downloaded.error });
      }

      return transition({ status: 'downloaded', version, installError: null });
   }

   async function install() {
      if (disposed || phase.status !== 'downloaded') return state;

      const version = phase.version;
      const loaded = await Result.tryPromise({ try: () => load(), catch: causeMessage });
      if (disposed) return state;
      if (Result.isError(loaded)) {
         return transition({ status: 'downloaded', version, installError: loaded.error });
      }
      if (phase.status !== 'downloaded' || phase.version !== version) return state;

      const quitTimer = setTimeout(options.quit, quitDelayMs);
      return transition({ status: 'installing', version, installer: loaded.value, quitTimer });
   }

   function dispose() {
      disposed = true;
      if (initialTimer) clearTimeout(initialTimer);
      if (pollTimer) clearInterval(pollTimer);
      initialTimer = null;
      pollTimer = null;
      if (phase.status === 'installing') clearTimeout(phase.quitTimer);
      listeners.clear();
   }

   return {
      getState: () => state,
      check,
      download,
      install,
      update: () => {
         if (!disposed) void check().then(download).then(install);
         return state;
      },
      subscribe: (listener: (state: UpdateState) => void) => {
         listeners.add(listener);
         return () => listeners.delete(listener);
      },
      start: () => {
         if (disposed || started || phase.status === 'disabled') return;
         started = true;

         initialTimer = setTimeout(() => {
            initialTimer = null;
            if (!disposed) void check();
         }, initialCheckDelayMs);
         pollTimer = setInterval(() => {
            if (!disposed) void check();
         }, checkIntervalMs);
      },
      dispose,
      finishInstall: () => {
         if (phase.status !== 'installing') return 'idle';

         const { installer: pending, version, quitTimer } = phase;
         clearTimeout(quitTimer);
         lastError = null;
         const startedInstall = Result.try({ try: () => pending.quitAndInstall(true, true), catch: causeMessage });
         const failure = Result.isError(startedInstall) ? startedInstall.error : lastError;
         if (failure === null) {
            phase = { status: 'downloaded', version, installError: null };
            return 'started';
         }

         transition({ status: 'downloaded', version, installError: failure });
         return 'failed';
      }
   };
}

export async function loadElectronUpdater(appLog: AppLogWriter) {
   const { autoUpdater } = await import('electron-updater');
   autoUpdater.autoDownload = false;
   autoUpdater.autoInstallOnAppQuit = false;
   autoUpdater.autoRunAppAfterInstall = true;
   autoUpdater.disableWebInstaller = true;
   autoUpdater.logger = createUpdateLogger(appLog);

   return autoUpdater;
}

type UpdateLogValue = string | number | boolean | bigint | symbol | null | undefined | Error;

function createUpdateLogger(appLog: AppLogWriter): Logger {
   const write =
      (level: 'info' | 'warn' | 'error') =>
      (message?: UpdateLogValue, ...rest: UpdateLogValue[]) =>
         void appLog[level](`updater: ${[message, ...rest].map(String).join(' ')}`);

   return { info: write('info'), warn: write('warn'), error: write('error'), debug: write('info') };
}
