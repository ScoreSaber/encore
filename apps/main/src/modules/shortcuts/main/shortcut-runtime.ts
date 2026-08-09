import { Result, type Result as BetterResult } from 'better-result';
import { app, shell } from 'electron';

import { causeMessage } from '@/lib/errors';
import { encoreProtocol, type ShortcutProtocolState } from '@/modules/shortcuts/contract';
import { canUnregisterProtocol, isProtocolRegistered, setProtocolRegistered } from '@/modules/shortcuts/main/deep-link';
import { getSteamClientRoots } from '@/modules/stores/main/steam';

export type WindowsShortcutLink = {
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
   writeWindowsShortcut: (shortcutPath: string, link: WindowsShortcutLink) => BetterResult<void, string>;
   getProtocolState: () => ShortcutProtocolState;
   setProtocolRegistered: (registered: boolean) => ShortcutProtocolState;
};

export function createShortcutRuntime(): ShortcutRuntime {
   return {
      platform: process.platform,
      executablePath: app.getPath('exe'),
      desktopPath: app.getPath('desktop'),
      getSteamRoots: getSteamClientRoots,
      writeWindowsShortcut: (shortcutPath, link) =>
         Result.try({
            try: () => {
               const written = shell.writeShortcutLink(shortcutPath, 'create', {
                  target: link.target,
                  args: link.args,
                  cwd: link.workingDirectory,
                  description: link.description
               });

               if (!written) throw new Error('Windows refused to write the shortcut file');
            },
            catch: causeMessage
         }),
      getProtocolState: protocolState,
      setProtocolRegistered: (registered) => {
         setProtocolRegistered(encoreProtocol, registered);
         return protocolState();
      }
   };
}

function protocolState(): ShortcutProtocolState {
   return { scheme: encoreProtocol, registered: isProtocolRegistered(encoreProtocol), canUnregister: canUnregisterProtocol() };
}
