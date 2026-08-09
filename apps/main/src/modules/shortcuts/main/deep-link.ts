import { app, BrowserWindow } from 'electron';

import { encoreProtocol } from '@/modules/shortcuts/contract';

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

type ProtocolAction = (protocol: string, path?: string, args?: string[]) => boolean;

function withProtocolClient(scheme: string, action: ProtocolAction) {
   const entry = process.defaultApp ? process.argv[1] : undefined;

   return entry ? action(scheme, process.execPath, [resolve(entry)]) : action(scheme);
}

export function isProtocolRegistered(scheme: string) {
   return withProtocolClient(scheme, (protocol, path, args) => app.isDefaultProtocolClient(protocol, path, args));
}

export function canUnregisterProtocol() {
   return process.platform !== 'linux';
}

export function setProtocolRegistered(scheme: string, registered: boolean) {
   if (registered) withProtocolClient(scheme, (protocol, path, args) => app.setAsDefaultProtocolClient(protocol, path, args));
   else if (canUnregisterProtocol()) withProtocolClient(scheme, (protocol, path, args) => app.removeAsDefaultProtocolClient(protocol, path, args));

   return isProtocolRegistered(scheme);
}

export function registerDeepLinkIntake(schemes: readonly string[] = [encoreProtocol], fileExtensions: readonly string[] = []) {
   knownSchemes = schemes.map((scheme) => scheme.toLowerCase());
   knownExtensions = fileExtensions.map((extension) => extension.toLowerCase());

   app.on('second-instance', (_event, argv) => {
      focusExistingWindow();
      queueLinkFromArgv(argv);
      queueFileFromArgv(argv);
   });

   app.on('open-url', (event, url) => {
      event.preventDefault();
      queueDeepLink(url);
   });

   app.on('open-file', (event, path) => {
      event.preventDefault();
      focusExistingWindow();
      queueOpenedFile(path);
   });

   queueLinkFromArgv(process.argv);
   queueFileFromArgv(process.argv);
}

export function queueDeepLink(link: string) {
   const scheme = readScheme(link);
   if (!scheme) return;

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

export function queueOpenedFile(path: string) {
   const extension = readExtension(path);
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

function readScheme(link: string) {
   if (!URL.canParse(link)) return null;

   return new URL(link).protocol.slice(0, -1).toLowerCase();
}

function queueLinkFromArgv(argv: readonly string[]) {
   const link = argv.find((argument) => knownSchemes.some((scheme) => argument.toLowerCase().startsWith(`${scheme}://`)));
   if (link) queueDeepLink(link);
}

function queueFileFromArgv(argv: readonly string[]) {
   const path = argv.find((argument) => !argument.startsWith('-') && knownExtensions.includes(readExtension(argument) ?? ''));
   if (path) queueOpenedFile(path);
}

function readExtension(path: string) {
   const extension = extname(path).toLowerCase();

   return extension || null;
}

function focusExistingWindow() {
   const [window] = BrowserWindow.getAllWindows();
   if (!window || window.isDestroyed()) return;

   if (window.isMinimized()) window.restore();
   window.show();
   window.focus();
}
