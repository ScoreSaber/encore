import { Result } from 'better-result';

import type { IpcFailureResult } from '@/ipc/core';
import { causeMessage } from '@/lib/errors';
import { pathExists } from '@/lib/filesystem/path';
import type { InstallDetailRequest } from '@/modules/installs/contract';
import { launchOptionsSchema, launchPlatformFor } from '@/modules/launch/contract';
import {
   buildLaunchLink,
   shortcutKinds,
   unavailableShortcutPreview,
   type ReadyShortcutPreview,
   type ShortcutIssue,
   type ShortcutKind,
   type ShortcutPreview,
   type ShortcutProtocolResult,
   type ShortcutRequest,
   type ShortcutResult,
   type ShortcutState,
   type ShortcutWarning
} from '@/modules/shortcuts/contract';
import type { ShortcutRuntime } from '@/modules/shortcuts/main/shortcut-runtime';
import {
   findSteamShortcutKey,
   findSteamShortcutsPath,
   readSteamShortcuts,
   upsertSteamShortcut,
   writeSteamShortcuts,
   type SteamShortcutFile
} from '@/modules/shortcuts/main/steam-shortcuts';

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const shortcutIssueMessages = {
   'install-not-found': 'the install is not in the registry anymore',
   'invalid-options': 'the launch options are not something Encore can put in a shortcut',
   'steam-client-missing': 'the Steam client is not installed on this machine',
   'steam-file-unreadable': 'the Steam shortcuts file could not be read, so Encore left it alone',
   'steam-user-missing': 'no Steam user folder was found, so sign in to Steam once and try again',
   'unsupported-kind': 'this shortcut kind is not supported on this platform',
   'unsupported-platform': 'Encore can only create shortcuts on Windows and Linux for now',
   'write-failed': 'the shortcut file could not be written'
};

type ShortcutProblem = { issue: ShortcutIssue; detail?: string };

export type ShortcutService = ReturnType<typeof createShortcutService>;

export function createShortcutService(options: {
   runtime: ShortcutRuntime;
   getInstall: (request: InstallDetailRequest) => Promise<{ name: string } | null>;
}) {
   const platform = launchPlatformFor(options.runtime.platform);
   const kinds: ShortcutKind[] = platform === 'other' ? [] : [...shortcutKinds];

   function getState(): ShortcutState {
      return { platform, kinds, protocol: options.runtime.getProtocolState() };
   }

   async function preview(request: ShortcutRequest): Promise<ShortcutPreview> {
      if (platform === 'other') return unavailableShortcutPreview(request, 'unsupported-platform');
      if (!kinds.includes(request.kind)) return unavailableShortcutPreview(request, 'unsupported-kind');

      const parsed = launchOptionsSchema.safeParse(request.options);
      if (!parsed.success) return unavailableShortcutPreview(request, 'invalid-options');

      const install = await options.getInstall({
         targetId: request.targetId,
         installId: request.installId
      });
      if (!install) return unavailableShortcutPreview(request, 'install-not-found');

      const link = buildLaunchLink({
         targetId: request.targetId,
         installId: request.installId,
         options: parsed.data
      });
      const name = install.name;

      if (request.kind === 'steam') return previewSteam(request, name, link);

      const shortcutPath = join(options.runtime.desktopPath, `${shortcutFileName(name)}${platform === 'windows' ? '.lnk' : '.desktop'}`);
      const exists = await pathExists(shortcutPath);
      if (Result.isError(exists)) return unavailableShortcutPreview(request, 'write-failed', exists.error.detail);

      return ready(request, name, shortcutPath, link, exists.value ? ['replaces-existing'] : []);
   }

   async function create(request: ShortcutRequest): Promise<ShortcutResult> {
      const preparation = await preview(request);
      if (preparation.status === 'unavailable') return failed(preparation.issue, preparation.detail);

      const written = request.kind === 'steam' ? await createSteamShortcut(preparation) : await createDesktopShortcut(preparation);
      if (Result.isError(written)) return failed(written.error.issue, written.error.detail);

      return {
         ok: true,
         value: {
            kind: preparation.kind,
            name: preparation.name,
            shortcutPath: preparation.shortcutPath,
            link: preparation.link
         }
      };
   }

   function setProtocolRegistered(registered: boolean): ShortcutProtocolResult {
      return {
         ok: true,
         value: options.runtime.setProtocolRegistered(registered)
      };
   }

   async function previewSteam(request: ShortcutRequest, name: string, link: string): Promise<ShortcutPreview> {
      const file = await openSteamShortcuts();
      if (Result.isError(file)) return unavailableShortcutPreview(request, file.error.issue, file.error.detail);

      const warnings: ShortcutWarning[] = ['steam-must-be-closed'];
      if (findSteamShortcutKey(file.value, name) !== null) warnings.push('replaces-existing');

      return ready(request, name, file.value.path, link, warnings);
   }

   async function createSteamShortcut(preparation: ReadyShortcutPreview): Promise<Result<void, ShortcutProblem>> {
      const file = await openSteamShortcuts();
      if (Result.isError(file)) return Result.err<void, ShortcutProblem>(file.error);

      upsertSteamShortcut(file.value, {
         appName: preparation.name,
         executablePath: preparation.executablePath,
         startDirectory: dirname(preparation.executablePath),
         launchOptions: preparation.link
      });

      return writeSteamShortcuts(file.value);
   }

   async function createDesktopShortcut(preparation: ReadyShortcutPreview): Promise<Result<void, ShortcutProblem>> {
      if (platform === 'windows') {
         const written = options.runtime.writeWindowsShortcut(preparation.shortcutPath, {
            target: preparation.executablePath,
            args: `"${preparation.link}"`,
            workingDirectory: dirname(preparation.executablePath),
            description: `Starts ${preparation.name} through Encore`
         });

         return Result.isError(written) ? Result.err({ issue: 'write-failed', detail: written.error }) : Result.ok(undefined);
      }

      return Result.tryPromise({
         try: () =>
            writeFile(preparation.shortcutPath, desktopEntry(preparation), {
               mode: 0o755
            }),
         catch: (cause): ShortcutProblem => ({
            issue: 'write-failed',
            detail: causeMessage(cause)
         })
      });
   }

   async function openSteamShortcuts(): Promise<Result<SteamShortcutFile, ShortcutProblem>> {
      const path = await findSteamShortcutsPath(await options.runtime.getSteamRoots());
      if (Result.isError(path)) return Result.err(path.error);

      return readSteamShortcuts(path.value);
   }

   function ready(request: ShortcutRequest, name: string, shortcutPath: string, link: string, warnings: ShortcutWarning[]): ReadyShortcutPreview {
      return {
         status: 'ok',
         kind: request.kind,
         targetId: request.targetId,
         installId: request.installId,
         name,
         shortcutPath,
         executablePath: options.runtime.executablePath,
         link,
         warnings
      };
   }

   function desktopEntry(preparation: ReadyShortcutPreview) {
      return `${[
         '[Desktop Entry]',
         'Type=Application',
         `Name=${singleLine(preparation.name)}`,
         `Comment=Starts ${singleLine(preparation.name)} through Encore`,
         `Exec="${preparation.executablePath}" "${preparation.link}"`,
         `Path=${dirname(preparation.executablePath)}`,
         'Terminal=false',
         'Categories=Game;'
      ].join('\n')}\n`;
   }

   return { getState, preview, create, setProtocolRegistered };
}

function failed(issue: ShortcutIssue, detail?: string): ShortcutResult {
   const error: IpcFailureResult['error'] = { code: `shortcuts.${issue}`, message: shortcutIssueMessages[issue] };
   if (detail) error.details = { detail };
   return { ok: false, error };
}

export function shortcutFileName(name: string) {
   const cleaned = singleLine(name)
      .replaceAll(/["*/:<>?\\|]/g, '-')
      .trim();

   return cleaned.slice(0, 80) || 'Beat Saber';
}

function singleLine(value: string) {
   return value.replaceAll(/\p{Cc}/gu, ' ').trim();
}
