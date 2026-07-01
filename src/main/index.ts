import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';

import { initializeAutoUpdates, registerUpdateHandlers } from '@/main/updater';
import { getEncoreReleaseInfo } from '@/main/version';
import { IpcChannel, type AppInfo } from '@/shared/ipc/contracts';

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

function createAppInfo(): AppInfo {
   const appVersion = app.getVersion();
   const release = getEncoreReleaseInfo({
      appVersion,
      isPackaged: app.isPackaged,
      cwd: process.cwd()
   });

   return {
      name: app.getName(),
      version: appVersion,
      release,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
   };
}

function registerIpcHandlers() {
   const appInfo = createAppInfo();
   ipcMain.handle(IpcChannel.AppInfo, () => appInfo);
   registerUpdateHandlers();
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
