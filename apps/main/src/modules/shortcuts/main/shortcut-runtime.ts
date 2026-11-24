import { Result } from 'better-result';
import { app, shell } from 'electron';

import type { IpcResult } from '@/ipc/core';
import { causeMessage } from '@/lib/errors';
import { encoreProtocol, type ShortcutProtocolState } from '@/modules/shortcuts/contract';
import { canUnregisterProtocol, isProtocolRegistered, setProtocolLinkRegistered } from '@/modules/shortcuts/main/deep-link';
import { getSteamClientRoots } from '@/modules/stores/main/steam-client';

type WindowsShortcutLink = {
   target: string;
   args: string;
   workingDirectory: string;
   description: string;
};

export type ShortcutRuntime = {
   platform: NodeJS.Platform;
   executablePath: string;
   desktopPath: string;
   getSteamRoots: () => Promise<readonly string[]>;
   writeWindowsShortcut: (shortcutPath: string, link: WindowsShortcutLink) => Result<void, string>;
   getProtocolState: () => ShortcutProtocolState;
   setProtocolRegistered: (registered: boolean) => Promise<IpcResult<ShortcutProtocolState>>;
};

export function createShortcutRuntime(): ShortcutRuntime {
   return {
      platform: process.platform,
      executablePath: process.env.APPIMAGE ?? app.getPath('exe'),
      desktopPath: app.getPath('desktop'),
      getSteamRoots: getSteamClientRoots,
      writeWindowsShortcut: (shortcutPath, link) =>
         Result.try({
            try: () =>
               shell.writeShortcutLink(shortcutPath, 'create', {
                  target: link.target,
                  args: link.args,
                  cwd: link.workingDirectory,
                  description: link.description
               }),
            catch: causeMessage
         }).andThen((written) => (written ? Result.ok() : Result.err('Windows refused to write the shortcut file'))),
      getProtocolState: protocolState,
      setProtocolRegistered: (registered) => setProtocolLinkRegistered(encoreProtocol, registered)
   };
}

function protocolState(): ShortcutProtocolState {
   return { scheme: encoreProtocol, registered: isProtocolRegistered(encoreProtocol), canUnregister: canUnregisterProtocol() };
}
