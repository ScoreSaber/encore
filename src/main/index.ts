import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, session, shell } from 'electron';

import { createAppIpcModule } from '@/main/ipc/modules/app-ipc';
import { createOperationsIpcModule } from '@/main/ipc/modules/operations-ipc';
import { createSettingsIpcModule } from '@/main/ipc/modules/settings-ipc';
import { createTargetsIpcModule } from '@/main/ipc/modules/targets-ipc';
import { createUpdateIpcModule } from '@/main/ipc/modules/update-ipc';
import { registerIpcModules } from '@/main/ipc/register-ipc-modules';
import { createOperationRegistry } from '@/main/operations/operation-registry';
import { createSettingsStore } from '@/main/settings/settings-store';
import { initializeAutoUpdates } from '@/main/updater';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const devContentSecurityPolicy = [
   "default-src 'self'",
   "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
   "style-src 'self' 'unsafe-inline'",
   "img-src 'self' data: https:",
   "font-src 'self' data:",
   "connect-src 'self' http://localhost:* ws://localhost:* https:",
   "object-src 'none'",
   "base-uri 'self'",
   "frame-ancestors 'none'"
].join('; ');
const prodContentSecurityPolicy = [
   "default-src 'self'",
   "script-src 'self'",
   "style-src 'self' 'unsafe-inline'",
   "img-src 'self' data: https:",
   "font-src 'self' data:",
   "connect-src 'self' https:",
   "object-src 'none'",
   "base-uri 'self'",
   "frame-ancestors 'none'"
].join('; ');

function registerIpcHandlers() {
   const operationRegistry = createOperationRegistry();
   const settingsStore = createSettingsStore({
      dataPath: app.getPath('userData'),
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch
   });

   registerIpcModules([
      createAppIpcModule(),
      createSettingsIpcModule(settingsStore),
      createTargetsIpcModule(),
      createUpdateIpcModule(),
      createOperationsIpcModule(operationRegistry, {
         demoEnabled: is.dev
      })
   ]);
}

function configureSecurityHeaders() {
   session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
         responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [is.dev ? devContentSecurityPolicy : prodContentSecurityPolicy]
         }
      });
   });
}

function createMainWindow() {
   const mainWindow = new BrowserWindow({
      width: 980,
      height: 660,
      minWidth: 980,
      minHeight: 660,
      show: false,
      title: 'Encore',
      backgroundColor: '#09090b',
      autoHideMenuBar: true,
      webPreferences: {
         preload: join(currentDir, '../preload/index.js'),
         sandbox: false,
         contextIsolation: true,
         nodeIntegration: false,
         webSecurity: true,
         allowRunningInsecureContent: false
      }
   });

   mainWindow.once('ready-to-show', () => {
      mainWindow.show();
   });

   mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
   });

   mainWindow.webContents.on('will-navigate', (event, url) => {
      const devRendererUrl = process.env.ELECTRON_RENDERER_URL;
      const isDevRendererNavigation = is.dev && devRendererUrl && url.startsWith(devRendererUrl);
      const isPackagedRendererNavigation = url.startsWith('file://');

      if (isDevRendererNavigation || isPackagedRendererNavigation) return;

      event.preventDefault();
      void shell.openExternal(url);
   });

   if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
   } else {
      void mainWindow.loadFile(join(currentDir, '../renderer/index.html'));
   }

   return mainWindow;
}

app.whenReady().then(() => {
   electronApp.setAppUserModelId('com.scoresaber.encore');
   configureSecurityHeaders();
   registerIpcHandlers();
   initializeAutoUpdates();

   app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
   });

   app.on('web-contents-created', (_, contents) => {
      contents.on('will-attach-webview', (event) => {
         event.preventDefault();
      });
   });

   createMainWindow();

   app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
         createMainWindow();
      }
   });
});

app.on('window-all-closed', () => {
   if (process.platform !== 'darwin') {
      app.quit();
   }
});
