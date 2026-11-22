import { Result } from 'better-result';
import { BrowserWindow, session } from 'electron';
import { z } from 'zod';

import { causeMessage, createProblem } from '@/lib/errors';
import { translate } from '@/lib/messages';
import { isMetaAuthToken, type MetaAuthProblem, type MetaAuthRequest } from '@/modules/downloads/main/meta-auth';

const metaLoginUrl = 'https://secure.oculus.com';
const metaProfileUrl = 'https://secure.oculus.com/my/profile';
// an unprefixed Electron partition is in-memory, keeping Meta auth isolated from Encore's session
const metaAuthPartition = 'encore-meta-auth';
const metaAuthCookieName = 'oc_ac_at';
const metaAuthTimeoutMs = 600_000;
const clearStorageTimeoutMs = 5_000;
let metaAuthQueue = Promise.resolve();

export const requestMetaAuthToken: MetaAuthRequest = async (options) => {
   if (options.signal.aborted) return Result.err(createProblem('downloads.oculus.sign-in-cancelled'));

   const previous = metaAuthQueue;
   let release: () => void = () => undefined;
   metaAuthQueue = new Promise<void>((resolve) => {
      release = resolve;
   });

   const abortedWhileQueued = await waitForTurn(previous, options.signal);
   if (abortedWhileQueued || options.signal.aborted) {
      void previous.finally(release);
      return Result.err(createProblem('downloads.oculus.sign-in-cancelled'));
   }

   const authenticated = await Result.tryPromise({
      try: () => openMetaAuthWindow(options),
      catch: () => createProblem('downloads.oculus.sign-in-failed')
   });
   release();

   return Result.isError(authenticated) ? Result.err(authenticated.error) : authenticated.value;
};

function waitForTurn(previous: Promise<void>, signal: AbortSignal) {
   return new Promise<boolean>((resolve) => {
      if (signal.aborted) return resolve(true);

      let done = false;
      const finish = (aborted: boolean) => {
         if (done) return;
         done = true;
         signal.removeEventListener('abort', onAbort);
         resolve(aborted);
      };
      const onAbort = () => finish(true);
      signal.addEventListener('abort', onAbort, { once: true });
      void previous.then(() => finish(false));
   });
}

const openMetaAuthWindow: MetaAuthRequest = ({ signal }) => {
   if (signal.aborted) return Promise.resolve(Result.err(createProblem('downloads.oculus.sign-in-cancelled')));

   const authWindow = new BrowserWindow({
      width: 560,
      height: 820,
      title: translate('downloads.metaSignIn'),
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      webPreferences: {
         partition: metaAuthPartition,
         sandbox: true,
         contextIsolation: true,
         nodeIntegration: false,
         webSecurity: true,
         allowRunningInsecureContent: false,
         spellcheck: false
      }
   });
   const childWindows = new Set<BrowserWindow>();

   authWindow.webContents.setWindowOpenHandler(({ url }) =>
      url.startsWith('https://')
         ? {
              action: 'allow',
              overrideBrowserWindowOptions: {
                 webPreferences: { partition: metaAuthPartition, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
              }
           }
         : { action: 'deny' }
   );
   authWindow.webContents.on('did-create-window', (window) => {
      childWindows.add(window);
      window.once('closed', () => childWindows.delete(window));
   });

   return new Promise<Result<string, MetaAuthProblem>>((resolve) => {
      let settled = false;

      const settle = (result: Result<string, MetaAuthProblem>) => {
         if (settled) return;
         settled = true;

         clearTimeout(timeout);
         signal.removeEventListener('abort', abort);
         for (const child of childWindows) {
            if (!child.isDestroyed()) child.destroy();
         }
         childWindows.clear();
         if (!authWindow.isDestroyed()) authWindow.destroy();
         void finishMetaAuth(result, resolve);
      };

      const abort = () => settle(Result.err(createProblem('downloads.oculus.sign-in-cancelled')));
      const timeout = setTimeout(() => settle(Result.err(createProblem('downloads.oculus.sign-in-timed-out'))), metaAuthTimeoutMs);

      const tryReadToken = async () => {
         if (settled || authWindow.isDestroyed()) return;
         if (!authWindow.webContents.getURL().startsWith(metaProfileUrl)) return;

         const cookies = await Result.tryPromise({
            try: () => authWindow.webContents.session.cookies.get({ name: metaAuthCookieName }),
            catch: causeMessage
         });

         const token = Result.unwrapOr(cookies, []).at(0)?.value;
         if (!isMetaAuthToken(token)) return;

         settle(Result.ok(token));
      };

      signal.addEventListener('abort', abort, { once: true });
      authWindow.webContents.on('did-stop-loading', () => void tryReadToken());
      authWindow.webContents.on('did-navigate', () => void tryReadToken());
      authWindow.webContents.on('did-navigate-in-page', () => void tryReadToken());
      authWindow.on('closed', () => settle(Result.err(createProblem('downloads.oculus.sign-in-cancelled'))));

      void loadMetaLogin(authWindow, settle);
   });
};

async function loadMetaLogin(authWindow: BrowserWindow, settle: (result: Result<string, MetaAuthProblem>) => void) {
   const loaded = await Result.tryPromise({
      try: () => authWindow.loadURL(metaLoginUrl),
      catch: (cause) => cause
   });
   if (Result.isError(loaded) && !isNavigationRedirectAbort(loaded.error)) {
      settle(Result.err(createProblem('downloads.oculus.sign-in-failed')));
   }
}

const navigationAbortSchema = z.object({ errno: z.number().optional(), code: z.string().optional() });

function isNavigationRedirectAbort(cause: unknown) {
   const parsed = navigationAbortSchema.safeParse(cause);
   return parsed.success && (parsed.data.errno === -3 || parsed.data.code === 'ERR_ABORTED');
}

async function finishMetaAuth(result: Result<string, MetaAuthProblem>, resolve: (result: Result<string, MetaAuthProblem>) => void) {
   // clear the ephemeral session after every outcome so a cancelled flow leaves no Meta login behind
   const timeout = new Promise<void>((done) => {
      const timer = setTimeout(done, clearStorageTimeoutMs);
      timer.unref();
   });
   await Promise.race([
      Result.tryPromise({
         try: () => session.fromPartition(metaAuthPartition).clearStorageData(),
         catch: () => undefined
      }),
      timeout
   ]);
   resolve(result);
}
