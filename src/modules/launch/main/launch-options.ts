import { beatSaberSteamAppId } from '@/modules/downloads/main/steam-client';
import { launchFlags, type LaunchFlag } from '@/modules/launch/contract';
import type { ProtonLaunchPlan } from '@/modules/launch/contract';
import { steamRunCommand } from '@/modules/launch/main/proton';
import type { StoreKind } from '@/modules/stores/contract';

import { join } from 'node:path';

const flagArguments: Record<LaunchFlag, readonly string[]> = {
   'oculus-mode': ['-vrmode', 'oculus'],
   fpfc: ['fpfc'],
   debug: ['--verbose'],
   editor: ['editor'],
   'skip-steam': [],
   'proton-logs': []
};

const managedCopyArgument = '--no-yeet';

const wineDllOverrides = 'winhttp=n,b';
const protonLogDirectoryName = 'Logs';

export function buildLaunchArgs(input: { flags: readonly LaunchFlag[]; args: readonly string[]; isStoreInstall: boolean }) {
   const args = input.isStoreInstall ? [] : [managedCopyArgument];

   for (const flag of launchFlags) {
      if (input.flags.includes(flag)) args.push(...flagArguments[flag]);
   }

   return [...args, ...input.args];
}

export function protonLogPath(installPath: string) {
   return join(installPath, protonLogDirectoryName);
}

export function buildLaunchEnv(input: { store: StoreKind | null; installPath: string; proton: ProtonLaunchPlan | null }): Record<string, string> {
   const steamEnv: Record<string, string> =
      input.store !== 'oculus'
         ? {
              SteamAppId: beatSaberSteamAppId,
              SteamOverlayGameId: beatSaberSteamAppId,
              SteamGameId: beatSaberSteamAppId
           }
         : {};

   if (!input.proton) return steamEnv;

   return {
      ...steamEnv,
      WINEDLLOVERRIDES: wineDllOverrides,
      STEAM_COMPAT_DATA_PATH: input.proton.compatDataPath,
      STEAM_COMPAT_INSTALL_PATH: input.installPath,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: input.proton.steamClientPath,
      STEAM_COMPAT_APP_ID: beatSaberSteamAppId,
      SteamEnv: '1',
      ...(input.proton.logPath ? { PROTON_LOG: '1', PROTON_LOG_DIR: input.proton.logPath } : {})
   };
}

export function buildProtonCommand(input: { proton: ProtonLaunchPlan; executablePath: string; args: readonly string[] }) {
   const protonArgs = [input.proton.protonBinaryPath, 'run', input.executablePath, ...input.args];

   return input.proton.steamRunWrapper
      ? { executablePath: steamRunCommand, args: protonArgs }
      : { executablePath: input.proton.protonBinaryPath, args: protonArgs.slice(1) };
}
