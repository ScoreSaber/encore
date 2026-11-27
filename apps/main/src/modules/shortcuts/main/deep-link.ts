import { Result } from 'better-result';
import { app, BrowserWindow } from 'electron';

import type { LinkProtocolState } from '@/ipc/core';
import { createProblem, type Problem } from '@/lib/errors';
import { translate } from '@/lib/messages';
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

export async function isProtocolRegistered(scheme: string) {
   if (process.platform !== 'linux') return isNativeProtocolRegistered(scheme);
   return isLinuxProtocolRegistered(scheme, app.isPackaged);
}

export function registerDefaultEncoreProtocol() {
   if (process.platform === 'linux') return;
   withProtocolClient(encoreProtocol, (protocol, path, args) => app.setAsDefaultProtocolClient(protocol, path, args));
}

async function setProtocolsRegistered(schemes: readonly string[], registered: boolean): Promise<Result<void, Problem>> {
   if (process.platform === 'linux') {
      if (registered) {
         const entry = process.defaultApp ? process.argv[1] : undefined;
         const command = [process.env.APPIMAGE ?? process.execPath, ...(entry ? [resolve(entry)] : [])];
         return registerLinuxProtocols(schemes, command);
      }
      return unregisterLinuxProtocols(schemes, (scheme) => app.isPackaged && isNativeProtocolRegistered(scheme));
   }

   return Result.try({
      try: () => {
         for (const scheme of schemes) {
            if (registered === isNativeProtocolRegistered(scheme)) continue;
            withProtocolClient(scheme, (protocol, path, args) =>
               registered ? app.setAsDefaultProtocolClient(protocol, path, args) : app.removeAsDefaultProtocolClient(protocol, path, args)
            );
         }
         return schemes.every((scheme) => isNativeProtocolRegistered(scheme) === registered);
      },
      catch: (cause) => createProblem('shortcuts.protocol-change-failed', { cause })
   }).andThen((changed) => (changed ? Result.ok() : Result.err(createProblem('shortcuts.protocol-change-failed'))));
}

export async function readProtocolLinkState<Scheme extends string>(scheme: Scheme): Promise<LinkProtocolState & { scheme: Scheme }> {
   if (process.platform === 'linux' && process.env.FLATPAK_ID) {
      return { scheme, registered: false, canUnregister: false, unavailableReason: translate('settings.deepLinks.flatpakUnavailable') };
   }
   return { scheme, registered: await isProtocolRegistered(scheme), canUnregister: true };
}

export async function setProtocolLinkRegistered<Scheme extends string>(scheme: Scheme, registered: boolean) {
   const changed = await setProtocolsRegistered([scheme], registered);
   if (Result.isError(changed)) return Result.err(changed.error);
   return Result.ok(await readProtocolLinkState(scheme));
}

export async function readProtocolsLinkState<Scheme extends string>(schemes: readonly Scheme[]) {
   const states = await Promise.all(schemes.map(readProtocolLinkState));
   return {
      schemes: [...schemes],
      registered: states.every((state) => state.registered),
      canUnregister: states.every((state) => state.canUnregister),
      unavailableReason: states.find((state) => state.unavailableReason)?.unavailableReason
   };
}

export async function setProtocolsLinkRegistered<Scheme extends string>(schemes: readonly Scheme[], registered: boolean) {
   const changed = await setProtocolsRegistered(schemes, registered);
   if (Result.isError(changed)) return Result.err(changed.error);
   return Result.ok(await readProtocolsLinkState(schemes));
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
