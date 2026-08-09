import { Result } from 'better-result';
import { app } from 'electron';
import type { AppUpdater, Logger } from 'electron-updater';

import { broadcastIpcEvent } from '@/ipc/main';
import { causeFailure } from '@/lib/errors';
import type { UpdateSnapshot } from '@/modules/updates/contract';
import { updatesIpc } from '@/modules/updates/ipc';
import { createAppPackaging } from '@/packaging';

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const initialUpdateCheckDelayMs = 3_000;
const updateLogFileName = 'updater.log';
const maxPendingUpdateLogLines = 256;

type UpdateLogLevel = 'debug' | 'error' | 'info' | 'warn';

const packaging = createAppPackaging({ packaged: app.isPackaged, platform: process.platform, env: process.env });

let updateSnapshot = createInitialUpdateSnapshot();
let loadedAutoUpdater: AppUpdater | null = null;
let autoUpdaterLoad: Promise<AppUpdater> | null = null;
let pendingUpdateInstaller: AppUpdater | null = null;
let writingUpdateLog = false;
const pendingUpdateLogLines: string[] = [];

export function getUpdateSnapshot() {
   return updateSnapshot;
}

export function initializeAutoUpdates() {
   if (!packaging.updateChecks) {
      publishUpdateSnapshot(createInitialUpdateSnapshot());
      return;
   }

   setTimeout(() => {
      void checkForUpdates();
   }, initialUpdateCheckDelayMs);
}

export async function checkForUpdates() {
   if (!packaging.updateChecks) return updateSnapshot;
   if (updateSnapshot.status === 'checking' || updateSnapshot.status === 'downloading' || updateSnapshot.status === 'downloaded') {
      return updateSnapshot;
   }

   const result = await Result.tryPromise({
      try: async () => (await loadAutoUpdater()).checkForUpdates(),
      catch: (cause) => causeFailure('failed to check for updates', cause)
   });

   if (Result.isError(result)) {
      publishUpdateSnapshot({
         status: 'error',
         message: result.error
      });
   }

   return updateSnapshot;
}

export function installDownloadedUpdate() {
   if (updateSnapshot.status !== 'downloaded' || !loadedAutoUpdater) return updateSnapshot;

   pendingUpdateInstaller = loadedAutoUpdater;
   app.quit();
   return updateSnapshot;
}

export function startDownloadedUpdateInstall() {
   const autoUpdater = pendingUpdateInstaller;
   if (!autoUpdater) return false;

   const result = Result.try({
      try: () => autoUpdater.quitAndInstall(true, true),
      catch: (cause) => causeFailure('failed to install update', cause)
   });

   if (Result.isError(result)) {
      publishUpdateSnapshot({
         status: 'error',
         message: result.error
      });
   }

   const started = !Result.isError(result) && updateSnapshot.status === 'downloaded';
   if (!started) {
      pendingUpdateInstaller = null;
      app.relaunch();
   }
   return started;
}

function loadAutoUpdater() {
   autoUpdaterLoad ??= import('electron-updater').then(({ autoUpdater }) => {
      configureAutoUpdater(autoUpdater);
      loadedAutoUpdater = autoUpdater;
      return autoUpdater;
   });

   return autoUpdaterLoad;
}

function configureAutoUpdater(autoUpdater: AppUpdater) {
   autoUpdater.autoDownload = packaging.selfUpdates;
   autoUpdater.autoInstallOnAppQuit = false;
   autoUpdater.autoRunAppAfterInstall = true;
   autoUpdater.disableWebInstaller = true;
   autoUpdater.logger = createUpdateLogger();

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
      publishUpdateSnapshot({
         status: 'downloading',
         version: updateSnapshot.version,
         percent: Math.round(progress.percent)
      });
   });

   autoUpdater.on('update-downloaded', (event) => {
      publishUpdateSnapshot({
         status: 'downloaded',
         version: event.version
      });
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
}

function createInitialUpdateSnapshot(): UpdateSnapshot {
   if (packaging.updateChecks) return { status: 'idle' };

   return {
      status: 'disabled',
      reason: packaging.packaged ? 'system-managed' : 'development'
   };
}

function publishUpdateSnapshot(snapshot: UpdateSnapshot) {
   const previousSnapshot = updateSnapshot;
   if (!snapshotChanged(previousSnapshot, snapshot)) return;

   updateSnapshot = snapshot;
   logUpdateMessage('info', formatUpdateSnapshot(updateSnapshot));
   broadcastIpcEvent(updatesIpc.onStatus, updateSnapshot);
}

function snapshotChanged(previousSnapshot: UpdateSnapshot, nextSnapshot: UpdateSnapshot) {
   return (
      previousSnapshot.status !== nextSnapshot.status ||
      previousSnapshot.version !== nextSnapshot.version ||
      previousSnapshot.percent !== nextSnapshot.percent ||
      previousSnapshot.message !== nextSnapshot.message ||
      previousSnapshot.reason !== nextSnapshot.reason
   );
}

function formatUpdateSnapshot(snapshot: UpdateSnapshot) {
   const details = [`status=${snapshot.status}`, `format=${packaging.format}`];

   if (snapshot.reason) details.push(`reason=${snapshot.reason}`);
   if (snapshot.version) details.push(`version=${snapshot.version}`);
   if (snapshot.percent != null) details.push(`percent=${snapshot.percent}`);
   if (snapshot.message) details.push(`message=${snapshot.message}`);

   return details.join(' ');
}

function createUpdateLogger(): Logger {
   return {
      info: (message) => logUpdateMessage('info', message),
      warn: (message) => logUpdateMessage('warn', message),
      error: (message) => logUpdateMessage('error', message),
      debug: (message) => logUpdateMessage('debug', message)
   };
}

function logUpdateMessage(level: UpdateLogLevel, message: string) {
   const line = `[${new Date().toISOString()}] [${level}] ${String(message)}\n`;
   queueUpdateLogLine(line);

   const consoleMessage = line.trimEnd();
   if (level === 'error') {
      console.error(consoleMessage);
      return;
   }

   if (level === 'warn') {
      console.warn(consoleMessage);
      return;
   }

   console.info(consoleMessage);
}

function queueUpdateLogLine(line: string) {
   if (pendingUpdateLogLines.length === maxPendingUpdateLogLines) pendingUpdateLogLines.shift();
   pendingUpdateLogLines.push(line);
   if (!writingUpdateLog) void flushUpdateLog();
}

async function flushUpdateLog() {
   writingUpdateLog = true;

   while (pendingUpdateLogLines.length > 0) {
      const lines = pendingUpdateLogLines.splice(0).join('');
      const result = await Result.tryPromise({
         try: async () => {
            await mkdir(app.getPath('logs'), { recursive: true });
            await appendFile(join(app.getPath('logs'), updateLogFileName), lines, 'utf8');
         },
         catch: (cause) => causeFailure('failed to write updater log', cause)
      });

      if (Result.isError(result)) console.warn(result.error);
   }

   writingUpdateLog = false;
}
