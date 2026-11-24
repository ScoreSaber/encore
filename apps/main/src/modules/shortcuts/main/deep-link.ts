import { app, BrowserWindow } from 'electron';

import type { IpcResult, LinkProtocolState } from '@/ipc/core';
import { createProblem } from '@/lib/errors';
import { encoreProtocol } from '@/modules/shortcuts/contract';
import { isLinuxProtocolRegistered, registerLinuxProtocols, unregisterLinuxProtocols } from '@/modules/shortcuts/main/linux-protocol';

import { extname, resolve } from 'node:path';

type DeepLinkSubscription = {
   schemes: string[];
   listener: (link: string) => void;
};

type FileSubscription = {
   extensions: string[];
   listener: (path: string) => void;
};

const pendingLinks: string[] = [];
const pendingFiles: string[] = [];
const subscriptions = new Set<DeepLinkSubscription>();
const fileSubscriptions = new Set<FileSubscription>();
let knownSchemes: string[] = [encoreProtocol];
let knownExtensions: string[] = [];
let intakeRegistered = false;

type ProtocolAction = (protocol: string, path?: string, args?: string[]) => boolean;

function withProtocolClient(scheme: string, action: ProtocolAction) {
   const entry = process.defaultApp ? process.argv[1] : undefined;

   return entry ? action(scheme, process.execPath, [resolve(entry)]) : action(scheme);
}

function isNativeProtocolRegistered(scheme: string) {
   return withProtocolClient(scheme, (protocol, path, args) => app.isDefaultProtocolClient(protocol, path, args));
}

export function isProtocolRegistered(scheme: string) {
   if (process.platform !== 'linux') return isNativeProtocolRegistered(scheme);
   return isLinuxProtocolRegistered(scheme, app.isPackaged);
}

export function canUnregisterProtocol() {
   return true;
}

export function registerDefaultEncoreProtocol() {
   if (process.platform === 'linux') return;
   withProtocolClient(encoreProtocol, (protocol, path, args) => app.setAsDefaultProtocolClient(protocol, path, args));
}

async function setProtocolsRegistered(schemes: readonly string[], registered: boolean) {
   if (process.platform === 'linux') {
      if (registered) {
         const entry = process.defaultApp ? process.argv[1] : undefined;
         const command = process.env.FLATPAK_ID
            ? ['flatpak', 'run', process.env.FLATPAK_ID]
            : [process.env.APPIMAGE ?? process.execPath, ...(entry ? [resolve(entry)] : [])];
         await registerLinuxProtocols(
            schemes.filter((scheme) => !isProtocolRegistered(scheme)),
            command
         );
      } else {
         await unregisterLinuxProtocols(schemes, (scheme) => app.isPackaged && isNativeProtocolRegistered(scheme));
      }
   } else {
      for (const scheme of schemes) {
         if (registered === isProtocolRegistered(scheme)) continue;
         withProtocolClient(scheme, (protocol, path, args) =>
            registered ? app.setAsDefaultProtocolClient(protocol, path, args) : app.removeAsDefaultProtocolClient(protocol, path, args)
         );
      }
   }

   for (const scheme of schemes) {
      if (isProtocolRegistered(scheme) !== registered) throw new Error(`The operating system did not change the handler for ${scheme}://`);
   }
}

export function readProtocolLinkState<Scheme extends string>(scheme: Scheme): LinkProtocolState & { scheme: Scheme } {
   return { scheme, registered: isProtocolRegistered(scheme), canUnregister: canUnregisterProtocol() };
}

export async function setProtocolLinkRegistered<Scheme extends string>(
   scheme: Scheme,
   registered: boolean
): Promise<IpcResult<LinkProtocolState & { scheme: Scheme }>> {
   try {
      await setProtocolsRegistered([scheme], registered);
      return { ok: true, value: readProtocolLinkState(scheme) };
   } catch (cause) {
      return { ok: false, error: createProblem('shortcuts.protocol-change-failed', { cause }) };
   }
}

export function readProtocolsLinkState<Scheme extends string>(schemes: readonly Scheme[]) {
   return { schemes: [...schemes], registered: schemes.every(isProtocolRegistered), canUnregister: canUnregisterProtocol() };
}

export async function setProtocolsLinkRegistered<Scheme extends string>(
   schemes: readonly Scheme[],
   registered: boolean
): Promise<IpcResult<{ schemes: Scheme[]; registered: boolean; canUnregister: boolean }>> {
   try {
      await setProtocolsRegistered(schemes, registered);
      return { ok: true, value: readProtocolsLinkState(schemes) };
   } catch (cause) {
      return { ok: false, error: createProblem('shortcuts.protocol-change-failed', { cause }) };
   }
}

export function registerDeepLinkIntake(schemes: readonly string[], fileExtensions: readonly string[]) {
   knownSchemes = schemes.map((scheme) => scheme.toLowerCase());
   knownExtensions = fileExtensions.map((extension) => extension.toLowerCase());
   if (intakeRegistered) return;
   intakeRegistered = true;

   app.on('second-instance', (_event, argv) => {
      focusExistingWindow();
      queueOpenFromArgv(argv);
   });

   app.on('open-url', (event, url) => {
      event.preventDefault();
      focusExistingWindow();
      queueDeepLink(url);
   });

   app.on('open-file', (event, path) => {
      event.preventDefault();
      focusExistingWindow();
      queueOpenedFile(path);
   });

   queueOpenFromArgv(process.argv);
}

function queueDeepLink(link: string) {
   const scheme = URL.canParse(link) ? new URL(link).protocol.slice(0, -1).toLowerCase() : null;
   if (!scheme || !knownSchemes.includes(scheme)) return;

   const matched = [...subscriptions].filter((subscription) => subscription.schemes.includes(scheme));
   if (matched.length === 0) {
      pendingLinks.push(link);
      return;
   }

   for (const subscription of matched) {
      subscription.listener(link);
   }
}

export function onDeepLink(schemes: readonly string[], listener: (link: string) => void) {
   const subscription: DeepLinkSubscription = { schemes: schemes.map((scheme) => scheme.toLowerCase()), listener };
   subscriptions.add(subscription);

   for (const link of pendingLinks.splice(0)) {
      queueDeepLink(link);
   }

   return () => {
      subscriptions.delete(subscription);
   };
}

function queueOpenedFile(path: string) {
   const extension = extname(path).toLowerCase();
   if (!extension || !knownExtensions.includes(extension)) return;

   const matched = [...fileSubscriptions].filter((subscription) => subscription.extensions.includes(extension));
   if (matched.length === 0) {
      pendingFiles.push(path);
      return;
   }

   for (const subscription of matched) {
      subscription.listener(path);
   }
}

export function onFileOpened(extensions: readonly string[], listener: (path: string) => void) {
   const subscription: FileSubscription = { extensions: extensions.map((extension) => extension.toLowerCase()), listener };
   fileSubscriptions.add(subscription);

   for (const path of pendingFiles.splice(0)) {
      queueOpenedFile(path);
   }

   return () => {
      fileSubscriptions.delete(subscription);
   };
}

function queueOpenFromArgv(argv: readonly string[]) {
   const link = argv.find((argument) => knownSchemes.some((scheme) => argument.toLowerCase().startsWith(`${scheme}://`)));
   if (link) {
      queueDeepLink(link);
      return;
   }

   const path = argv.find((argument) => {
      if (argument.startsWith('-')) return false;
      const extension = extname(argument).toLowerCase();
      return extension !== '' && knownExtensions.includes(extension);
   });
   if (path) queueOpenedFile(path);
}

function focusExistingWindow() {
   const [window] = BrowserWindow.getAllWindows();
   if (!window || window.isDestroyed()) return;

   if (window.isMinimized()) window.restore();
   window.show();
   window.focus();
}
