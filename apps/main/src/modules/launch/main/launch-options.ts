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

function cleanLinuxSearchPath(searchPath: string | undefined, excludeDir?: string) {
   if (!searchPath) return searchPath;

   const normalize = (dir: string) => dir.replace(/\/+$/, '') || '/';
   const excluded = excludeDir ? normalize(excludeDir) : undefined;
   const seen = new Set<string>();
   const dirs: string[] = [];

   for (const dir of searchPath.split(':')) {
      if (!dir) continue;
      const normalized = normalize(dir);
      if (seen.has(normalized)) continue;
      if (excluded && (normalized === excluded || normalized.startsWith(`${excluded}/`))) continue;

      seen.add(normalized);
      dirs.push(dir);
   }

   return dirs.join(':');
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
   if (input.proton.steamFrame) environment.DISABLE_VULKAN_FDM_INJECTION_LAYER ??= '1';
   if (input.proton.logPath) {
      environment.PROTON_LOG = '1';
      environment.PROTON_LOG_DIR = input.proton.logPath;
   }
   return { ...environment, ...buildProtonEnv(input.proton, input.installPath, 'XDG_DATA_DIRS' in environment) };
}

export function buildProtonEnv(proton: ProtonLaunchPlan, installPath: string, preserveXdgDataDirs = false): LaunchEnvironment {
   const env: LaunchEnvironment = {
      WINEDLLOVERRIDES: wineDllOverrides,
      STEAM_COMPAT_DATA_PATH: proton.compatDataPath,
      STEAM_COMPAT_INSTALL_PATH: installPath,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: proton.steamClientPath,
      STEAM_COMPAT_APP_ID: beatSaberSteamAppId
   };
   if (!preserveXdgDataDirs) {
      const cleaned = cleanLinuxSearchPath(process.env.XDG_DATA_DIRS, process.env.APPDIR);
      if (cleaned && cleaned !== process.env.XDG_DATA_DIRS) env.XDG_DATA_DIRS = cleaned;
   }
   return env;
}

export function buildProtonCommand(input: {
   proton: ProtonLaunchPlan;
   verb?: 'run' | 'runinprefix' | 'getcompatpath';
   executablePath: string;
   args: readonly string[];
   wrapper?: readonly string[];
   workingDirectory: string;
   env: LaunchEnvironment;
}) {
   const verb = input.verb ?? 'run';
   const protonArgs = [input.proton.protonBinaryPath, verb, input.executablePath, ...input.args];
   const [protonCommandPath = input.proton.protonBinaryPath, ...protonCommandArgs] = [
      ...(input.wrapper ?? []),
      ...(input.proton.steamRunWrapper ? [steamRunCommand] : []),
      ...protonArgs
   ];
   const protonCommand = { executablePath: protonCommandPath, args: protonCommandArgs };
   const command =
      verb === 'run' && input.proton.reaperPath
         ? {
              executablePath: input.proton.reaperPath,
              args: ['SteamLaunch', `AppId=${beatSaberSteamAppId}`, '--', protonCommand.executablePath, ...protonCommand.args]
           }
         : protonCommand;

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
