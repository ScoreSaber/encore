import { is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, nativeImage, session, shell } from 'electron';

import { openExternalUrl } from '@/external-navigation';
import { registerIpcEventWindow } from '@/ipc/main';
import { isSteamFrame } from '@/lib/platform/steam-frame';
import { isTrustedRendererNavigation } from '@/lib/security/external-url';
import windowIcon from '@/modules/app/main/window-icon.png?inline';
import type { AppLogWriter } from '@/modules/support/main/app-log';

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
   "connect-src 'self'",
   "object-src 'none'",
   "base-uri 'self'",
   "frame-ancestors 'none'"
].join('; ');

type CloseBehaviour = 'close' | 'hide' | 'minimize';
type WindowVisibility = 'hidden' | 'shown' | 'minimized';

let mainWindow: BrowserWindow | null = null;
let readyToShow = false;
let pendingVisibility: WindowVisibility = 'hidden';
let closeBehaviour = (): CloseBehaviour => 'close';

export function setMainWindowCloseBehaviour(decide: () => CloseBehaviour) {
   closeBehaviour = decide;
}

export function showMainWindow(log: AppLogWriter) {
   if (!mainWindow) return createMainWindow(log);

   pendingVisibility = 'shown';
   if (!readyToShow) return;

   if (mainWindow.isMinimized()) mainWindow.restore();
   mainWindow.show();
   mainWindow.focus();
}

export function minimizeMainWindow() {
   if (!mainWindow) return;

   pendingVisibility = 'minimized';
   if (!readyToShow) return;

   mainWindow.showInactive();
   mainWindow.minimize();
}

export function openMainWindow(log: AppLogWriter, options: { hidden: boolean }) {
   session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
         responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [is.dev ? devContentSecurityPolicy : prodContentSecurityPolicy]
         }
      });
   });
   session.defaultSession.on('will-download', (event) => event.preventDefault());

   app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window);
   });

   app.on('web-contents-created', (_, contents) => {
      contents.on('will-attach-webview', (event) => {
         event.preventDefault();
      });
   });

   createMainWindow(log, options);

   app.on('activate', () => showMainWindow(log));
}

function createMainWindow(log: AppLogWriter, options: { hidden: boolean } = { hidden: false }) {
   if (mainWindow && !mainWindow.isDestroyed()) {
      if (!options.hidden) showMainWindow(log);
      return;
   }

   readyToShow = false;
   pendingVisibility = options.hidden ? 'hidden' : 'shown';
   const rendererPath = join(currentDir, '../renderer/index.html');
   const rendererUrl = is.dev && process.env.VITE_DEV_SERVER_URL ? process.env.VITE_DEV_SERVER_URL : pathToFileURL(rendererPath).toString();
   const nativeChrome = isSteamFrame();
   const browserWindow = new BrowserWindow({
      width: 1236,
      height: 818,
      minWidth: 980,
      minHeight: 660,
      show: false,
      title: 'Encore',
      backgroundColor: '#09090b',
      autoHideMenuBar: true,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : nativeChrome ? 'default' : 'hidden',
      titleBarOverlay: nativeChrome ? false : { color: '#00000000', symbolColor: '#71717a', height: 32 },
      icon: process.platform === 'linux' ? nativeImage.createFromDataURL(windowIcon) : undefined,
      trafficLightPosition: process.platform === 'darwin' ? { x: 12, y: 9 } : undefined,
      webPreferences: {
         preload: join(currentDir, '../preload/index.cjs'),
         sandbox: true,
         contextIsolation: true,
         nodeIntegration: false,
         webSecurity: true,
         allowRunningInsecureContent: false,
         spellcheck: false
      }
   });
   mainWindow = browserWindow;
   registerIpcEventWindow(browserWindow);

   browserWindow.once('ready-to-show', () => {
      if (mainWindow !== browserWindow) return;

      readyToShow = true;
      if (pendingVisibility === 'shown') {
         browserWindow.show();
         browserWindow.focus();
      } else if (pendingVisibility === 'minimized') {
         browserWindow.showInactive();
         browserWindow.minimize();
      }
   });

   browserWindow.on('close', (event) => {
      const behaviour = closeBehaviour();
      if (behaviour === 'close') return;

      event.preventDefault();
      if (behaviour === 'hide') browserWindow.hide();
      else browserWindow.minimize();
   });

   browserWindow.on('closed', () => {
      if (mainWindow === browserWindow) {
         mainWindow = null;
         readyToShow = false;
         pendingVisibility = 'hidden';
      }
   });

   browserWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url, log);
      return { action: 'deny' };
   });

   browserWindow.webContents.on('will-navigate', (event, url) => {
      if (isTrustedRendererNavigation(url, rendererUrl)) return;

      event.preventDefault();
      openExternal(url, log);
   });

   if (is.dev && process.env.VITE_DEV_SERVER_URL) {
      void browserWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
   } else {
      void browserWindow.loadFile(rendererPath);
   }
}

function openExternal(url: string, log: AppLogWriter) {
   void openExternalUrl(url, (allowedUrl) => shell.openExternal(allowedUrl)).then((result) => {
      if (!result.allowed) void log.warn(`security: external navigation blocked (${result.reason})`);
   });
}
