import { launchFlags, type LaunchEnvironment, type LaunchFlag, type ProtonLaunchPlan } from '@/modules/launch/contract';
import type { StoreKind } from '@/modules/stores/contract';
import { beatSaberSteamAppId } from '@/modules/stores/main/steam-client';

const flagArguments = {
   'oculus-mode': ['-vrmode', 'oculus'],
   fpfc: ['fpfc'],
   debug: ['--verbose'],
   editor: ['editor'],
   'skip-steam': [],
   'proton-logs': []
};

const managedCopyArgument = '--no-yeet';

const steamRunCommand = 'steam-run';
const flatpakSpawnCommand = 'flatpak-spawn';
const wineDllOverrides = 'winhttp=n,b';

export function buildLaunchArgs(input: { flags: readonly LaunchFlag[]; args: readonly string[]; isStoreInstall: boolean }) {
   const args = input.isStoreInstall ? [] : [managedCopyArgument];

   for (const flag of launchFlags) {
      if (input.flags.includes(flag)) args.push(...flagArguments[flag]);
   }

   return [...args, ...input.args];
}

export function buildLaunchEnv(input: {
   store: StoreKind | null;
   installPath: string;
   proton: ProtonLaunchPlan | null;
   environment: LaunchEnvironment;
}) {
   const environment = { ...input.environment };
   if (input.store !== 'oculus') {
      environment.SteamAppId = beatSaberSteamAppId;
      environment.SteamOverlayGameId = beatSaberSteamAppId;
      environment.SteamGameId = beatSaberSteamAppId;
   }

   if (!input.proton) return environment;

   environment.SteamEnv = '1';
   if (input.proton.steamFrame) environment.DISABLE_VULKAN_FDM_INJECTION_LAYER = '1';
   if (input.proton.logPath) {
      environment.PROTON_LOG = '1';
      environment.PROTON_LOG_DIR = input.proton.logPath;
   }
   return { ...environment, ...buildProtonEnv(input.proton, input.installPath) };
}

export function buildProtonEnv(proton: ProtonLaunchPlan, installPath: string): LaunchEnvironment {
   return {
      WINEDLLOVERRIDES: wineDllOverrides,
      STEAM_COMPAT_DATA_PATH: proton.compatDataPath,
      STEAM_COMPAT_INSTALL_PATH: installPath,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: proton.steamClientPath,
      STEAM_COMPAT_APP_ID: beatSaberSteamAppId
   };
}

export function buildProtonCommand(input: {
   proton: ProtonLaunchPlan;
   verb?: 'run' | 'runinprefix' | 'getcompatpath';
   executablePath: string;
   args: readonly string[];
   workingDirectory: string;
   env: LaunchEnvironment;
}) {
   const protonArgs = [input.proton.protonBinaryPath, input.verb ?? 'run', input.executablePath, ...input.args];
   const command = input.proton.steamRunWrapper
      ? { executablePath: steamRunCommand, args: protonArgs }
      : { executablePath: input.proton.protonBinaryPath, args: protonArgs.slice(1) };

   if (!input.proton.flatpakHost) return command;

   return {
      executablePath: flatpakSpawnCommand,
      args: [
         '--host',
         `--directory=${input.workingDirectory}`,
         ...Object.entries(input.env).map(([name, value]) => `--env=${name}=${value}`),
         '--',
         command.executablePath,
         ...command.args
      ]
   };
}
