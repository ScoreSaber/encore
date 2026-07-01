import { Result } from 'better-result';
import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateDownloadedEvent } from 'electron-updater';

import { IpcChannel, type UpdateSnapshot, type UpdateStatus } from '@/shared/ipc/contracts';

const initialUpdateCheckDelayMs = 3_000;

let updateSnapshot = createInitialUpdateSnapshot();
let updaterInitialized = false;

export function registerUpdateHandlers() {
   ipcMain.handle(IpcChannel.UpdateInfo, () => updateSnapshot);
   ipcMain.handle(IpcChannel.UpdateCheck, () => checkForUpdates());
   ipcMain.handle(IpcChannel.UpdateInstall, () => installDownloadedUpdate());
}

export function initializeAutoUpdates() {
   if (updaterInitialized) return;
   updaterInitialized = true;

   if (!app.isPackaged) {
      publishUpdateSnapshot(createInitialUpdateSnapshot());
      return;
   }

   autoUpdater.autoDownload = true;
   autoUpdater.autoInstallOnAppQuit = true;
   autoUpdater.disableWebInstaller = true;
   autoUpdater.logger = console;

   autoUpdater.on('checking-for-update', () => {
      publishUpdateSnapshot({ status: 'checking' });
   });

   autoUpdater.on('update-available', (info) => {
      publishUpdateSnapshot({
         status: 'available',
         version: info.version
      });
   });

   autoUpdater.on('update-not-available', (info) => {
      publishUpdateSnapshot({
         status: 'not-available',
         version: info.version
      });
   });

   autoUpdater.on('download-progress', (progress) => {
      publishUpdateSnapshot(createDownloadSnapshot(progress));
   });

   autoUpdater.on('update-downloaded', (event) => {
      publishUpdateSnapshot(createDownloadedSnapshot(event));
   });

   autoUpdater.on('update-cancelled', (info) => {
      publishUpdateSnapshot({
         status: 'idle',
         version: info.version
      });
   });

   autoUpdater.on('error', (error, message) => {
      publishUpdateSnapshot({
         status: 'error',
         message: message ?? error.message
      });
   });

   setTimeout(() => {
      void checkForUpdates();
   }, initialUpdateCheckDelayMs);
}

async function checkForUpdates() {
   if (!app.isPackaged) return updateSnapshot;
   if (updateIsBusy(updateSnapshot.status)) return updateSnapshot;

   const result = await Result.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (cause) => updateErrorMessage('failed to check for updates', cause)
   });

   if (Result.isError(result)) {
      publishUpdateSnapshot({
         status: 'error',
         message: result.error
      });
   }

   return updateSnapshot;
}

function installDownloadedUpdate() {
   if (updateSnapshot.status !== 'downloaded') return updateSnapshot;

   const result = Result.try({
      try: () => {
         autoUpdater.quitAndInstall(false, true);
      },
      catch: (cause) => updateErrorMessage('failed to install update', cause)
   });

   if (Result.isError(result)) {
      publishUpdateSnapshot({
         status: 'error',
         message: result.error
      });
   }

   return updateSnapshot;
}

function createInitialUpdateSnapshot(): UpdateSnapshot {
   if (app.isPackaged) return { status: 'idle' };

   return {
      status: 'disabled',
      message: 'updates run in packaged builds'
   };
}

function createDownloadSnapshot(progress: ProgressInfo): UpdateSnapshot {
   return {
      status: 'downloading',
      version: updateSnapshot.version,
      percent: Math.round(progress.percent)
   };
}

function createDownloadedSnapshot(event: UpdateDownloadedEvent): UpdateSnapshot {
   return {
      status: 'downloaded',
      version: event.version
   };
}

function publishUpdateSnapshot(snapshot: UpdateSnapshot) {
   updateSnapshot = snapshot;

   for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;

      window.webContents.send(IpcChannel.UpdateStatus, updateSnapshot);
   }
}

function updateIsBusy(status: UpdateStatus) {
   return status === 'checking' || status === 'downloading' || status === 'downloaded';
}

function updateErrorMessage(message: string, cause: unknown) {
   if (cause instanceof Error) return `${message}: ${cause.message}`;
   return `${message}: ${String(cause)}`;
}
