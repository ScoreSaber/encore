import { Result } from 'better-result';

import { createProblem, type Problem } from '@/lib/errors';
import { isSteamFrame } from '@/lib/platform/steam-frame';
import type { LaunchEnvironment, ProtonValidation } from '@/modules/launch/contract';
import {
   ensureProtonCompatData,
   findInstalledProton,
   readLinuxLaunchHost,
   validateProtonFolder,
   type LinuxLaunchHost
} from '@/modules/launch/main/proton';
import { readOculusClientState, type OculusClientState } from '@/modules/stores/main/oculus-client';
import { readSteamClientState, type SteamClientState } from '@/modules/stores/main/steam-client';

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export type LaunchCommand = {
   executablePath: string;
   args: readonly string[];
   workingDirectory: string;
   env: LaunchEnvironment;
   runAsAdmin: boolean;
};

type SpawnedProcess = { pid: number | null };
export type RunningProcess = SpawnedProcess & { exited: Promise<void>; stop: () => void };

type WatchdogCommand = {
   executablePath: string;
   args: readonly string[];
   workingDirectory: string;
};

export type PrepareLaunchWatchdog = () => Promise<Result<WatchdogCommand, Problem>>;

export type LaunchRuntime = {
   platform: NodeJS.Platform;
   steamFrame: boolean;
   readSteamClient: () => Promise<SteamClientState>;
   readOculusClient: () => Promise<OculusClientState>;
   readLinuxHost: () => Promise<LinuxLaunchHost>;
   validateProtonFolder: (path: string) => Promise<ProtonValidation>;
   findProton: (steamClientPath: string) => Promise<string | null>;
   prepareProtonCompatData: (compatDataPath: string) => Promise<Result<void, Problem>>;
   startSteamClient: () => Promise<Result<SpawnedProcess, Problem>>;
   startOculusClient: () => Promise<Result<SpawnedProcess, Problem>>;
   spawn: (command: LaunchCommand) => Promise<Result<RunningProcess, Problem>>;
   prepareWatchdog: PrepareLaunchWatchdog;
   spawnWatchdog: (command: WatchdogCommand) => Promise<Result<RunningProcess, Problem>>;
};

export function createLaunchRuntime({ prepareWatchdog }: { prepareWatchdog: PrepareLaunchWatchdog }): LaunchRuntime {
   return {
      platform: process.platform,
      steamFrame: isSteamFrame(),
      readSteamClient: readSteamClientState,
      readOculusClient: readOculusClientState,
      readLinuxHost: readLinuxLaunchHost,
      validateProtonFolder: (path) => validateProtonFolder(path, process.arch),
      findProton: (steamClientPath) => findInstalledProton(steamClientPath, process.arch),
      prepareProtonCompatData: ensureProtonCompatData,
      startSteamClient: async () => {
         const steam = await readSteamClientState();
         if (steam.status === 'missing' || steam.status === 'unsupported-platform') {
            return Result.err(createProblem('launch.steam.missing'));
         }

         return spawnDetached(steam.executablePath, [], dirname(steam.executablePath), {}, 'launch.process.spawn-failed');
      },
      startOculusClient: async () => {
         const oculus = await readOculusClientState();
         if (oculus.status === 'missing') {
            return Result.err(createProblem('launch.oculus.missing'));
         }

         return spawnDetached(oculus.executablePath, [], dirname(oculus.executablePath), {}, 'launch.process.spawn-failed');
      },
      spawn: (command) => {
         if (!command.runAsAdmin) {
            return spawnDetached(command.executablePath, command.args, command.workingDirectory, command.env, 'launch.process.spawn-failed');
         }
         const elevated = elevatedLaunchCommand(command);
         return spawnDetached(elevated.executablePath, elevated.args, command.workingDirectory, elevated.env, 'launch.process.spawn-failed');
      },
      prepareWatchdog,
      spawnWatchdog: (command) => spawnDetached(command.executablePath, command.args, command.workingDirectory, {}, 'launch.watchdog.spawn-failed')
   };
}

function spawnDetached(
   executablePath: string,
   args: readonly string[],
   workingDirectory: string,
   env: LaunchEnvironment,
   code: 'launch.process.spawn-failed' | 'launch.watchdog.spawn-failed'
) {
   return new Promise<Result<RunningProcess, Problem>>((resolve) => {
      const child = spawn(executablePath, [...args], {
         cwd: workingDirectory,
         env: { ...process.env, ...env },
         detached: true,
         stdio: 'ignore'
      });
      const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));

      child.once('spawn', () => {
         child.unref();
         resolve(Result.ok({ pid: child.pid ?? null, exited, stop: () => child.kill() }));
      });

      child.once('error', (cause) => {
         resolve(Result.err(createProblem(code, { cause })));
      });
   });
}

const elevatedLaunchScript = [
   "$launch = @{ FilePath = $env:ENCORE_LAUNCH_FILE; WorkingDirectory = $env:ENCORE_LAUNCH_DIRECTORY; Verb = 'RunAs'; Wait = $true }",
   'if ($env:ENCORE_LAUNCH_ARGS) { $launch.ArgumentList = $env:ENCORE_LAUNCH_ARGS }',
   'Start-Process @launch'
].join('; ');

export function elevatedLaunchCommand(command: LaunchCommand) {
   return {
      executablePath: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', elevatedLaunchScript],
      env: {
         ...command.env,
         ENCORE_LAUNCH_FILE: command.executablePath,
         ENCORE_LAUNCH_DIRECTORY: command.workingDirectory,
         ENCORE_LAUNCH_ARGS: command.args.map(quoteWindowsArg).join(' ')
      }
   };
}

function quoteWindowsArg(arg: string) {
   if (arg && !/[\s"]/.test(arg)) return arg;
   return `"${arg.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}
