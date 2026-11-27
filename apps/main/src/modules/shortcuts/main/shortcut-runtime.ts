import { Result } from 'better-result';
import { app, shell } from 'electron';

import { causeMessage, type Problem } from '@/lib/errors';
import { encoreProtocol, type ShortcutProtocolState } from '@/modules/shortcuts/contract';
import { readProtocolLinkState, setProtocolLinkRegistered } from '@/modules/shortcuts/main/deep-link';
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
   getProtocolState: () => Promise<ShortcutProtocolState>;
   setProtocolRegistered: (registered: boolean) => Promise<Result<ShortcutProtocolState, Problem>>;
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
      getProtocolState: () => readProtocolLinkState(encoreProtocol),
      setProtocolRegistered: (registered) => setProtocolLinkRegistered(encoreProtocol, registered)
   };
}
