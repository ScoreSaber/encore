import { Result, type Result as BetterResult } from 'better-result';

import { readSteamClientState, type SteamClientState } from '@/modules/downloads/main/steam-client';
import type { ProtonValidation } from '@/modules/launch/contract';
import { readOculusClientState, type OculusClientState } from '@/modules/launch/main/oculus-client';
import { ensureProtonCompatData, readLinuxLaunchHost, validateProtonFolder, type LinuxLaunchHost } from '@/modules/launch/main/proton';
import type { OperationError } from '@/modules/operations/contract';

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';

export type LaunchCommand = {
   executablePath: string;
   args: readonly string[];
   workingDirectory: string;
   env: Record<string, string>;
   runAsAdmin: boolean;
};

export type SpawnedProcess = { pid: number | null };

export type LaunchRuntime = {
   platform: NodeJS.Platform;
   readSteamClient: () => Promise<SteamClientState>;
   readOculusClient: () => Promise<OculusClientState>;
   readLinuxHost: () => Promise<LinuxLaunchHost>;
   validateProtonFolder: (path: string) => Promise<ProtonValidation>;
   prepareProtonCompatData: (compatDataPath: string) => Promise<BetterResult<void, OperationError>>;
   startSteamClient: () => Promise<BetterResult<SpawnedProcess, OperationError>>;
   startOculusClient: () => Promise<BetterResult<SpawnedProcess, OperationError>>;
   spawn: (command: LaunchCommand) => Promise<BetterResult<SpawnedProcess, OperationError>>;
};

export function createLaunchRuntime(): LaunchRuntime {
   return {
      platform: process.platform,
      readSteamClient: readSteamClientState,
      readOculusClient: readOculusClientState,
      readLinuxHost: readLinuxLaunchHost,
      validateProtonFolder,
      prepareProtonCompatData: ensureProtonCompatData,
      startSteamClient: async () => {
         const steam = await readSteamClientState();
         if (steam.status === 'missing' || steam.status === 'unsupported-platform') {
            return Result.err({ code: 'launch.steam.missing', message: 'the Steam client is not installed on this machine' });
         }

         return spawnDetached(steam.executablePath, [], dirname(steam.executablePath), {});
      },
      startOculusClient: async () => {
         const oculus = await readOculusClientState();
         if (oculus.status === 'missing') {
            return Result.err({ code: 'launch.oculus.missing', message: 'the Oculus client is not installed on this machine' });
         }

         return spawnDetached(oculus.executablePath, [], dirname(oculus.executablePath), {});
      },
      spawn: (command) =>
         command.runAsAdmin ? spawnElevated(command) : spawnDetached(command.executablePath, command.args, command.workingDirectory, command.env)
   };
}

function spawnDetached(executablePath: string, args: readonly string[], workingDirectory: string, env: Record<string, string>) {
   return new Promise<BetterResult<SpawnedProcess, OperationError>>((resolve) => {
      const child = spawn(executablePath, [...args], {
         cwd: workingDirectory,
         env: { ...process.env, ...env },
         detached: true,
         stdio: 'ignore'
      });

      child.once('spawn', () => {
         child.unref();
         resolve(Result.ok({ pid: child.pid ?? null }));
      });

      child.once('error', (cause: Error) => {
         resolve(Result.err({ code: 'launch.process.spawn-failed', message: `failed to start Beat Saber: ${cause.message}` }));
      });
   });
}

function spawnElevated(command: LaunchCommand) {
   const script = [
      ...Object.entries(command.env).map(([name, value]) => `$env:${name} = ${quoteForPowerShell(value)}`),
      [
         'Start-Process',
         `-FilePath ${quoteForPowerShell(command.executablePath)}`,
         `-WorkingDirectory ${quoteForPowerShell(command.workingDirectory)}`,
         command.args.length > 0 ? `-ArgumentList ${command.args.map((arg) => quoteForPowerShell(arg)).join(',')}` : '',
         '-Verb RunAs'
      ]
         .filter(Boolean)
         .join(' ')
   ].join('; ');

   return spawnDetached('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], command.workingDirectory, {});
}

export function quoteForPowerShell(value: string) {
   return `'${value.replaceAll("'", "''")}'`;
}
