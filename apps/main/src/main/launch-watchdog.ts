import { Result } from 'better-result';
import { app } from 'electron';

import { causeMessage } from '@/lib/errors';
import { beatSaberExecutableName } from '@/modules/launch/contract';
import type { PrepareLaunchWatchdog, WatchdogCommand } from '@/modules/launch/main/launch-runtime';
import type { OperationError } from '@/modules/operations/contract';

import { constants } from 'node:fs';
import { access, copyFile, chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const watchdogName = 'encore-watchdog';

export function createLaunchWatchdog(dataPath: string): PrepareLaunchWatchdog {
   return async () => {
      const sourcePath = watchdogSourcePath();
      const flatpakId = process.env.FLATPAK_ID;
      const available = await Result.tryPromise({
         try: () => access(sourcePath, constants.X_OK),
         catch: (cause) => ({
            code: 'launch.watchdog.unavailable',
            message: `Encore's resource saver is not available: ${causeMessage(cause)}`
         })
      });
      if (Result.isError(available)) return Result.err<WatchdogCommand, OperationError>(available.error);

      if (process.platform === 'linux' && flatpakId) {
         const hostDirectory = join(dataPath, 'watchdog');
         const hostPath = join(hostDirectory, watchdogName);
         const copied = await Result.tryPromise({
            try: async () => {
               await mkdir(hostDirectory, { recursive: true });
               await copyFile(sourcePath, hostPath);
               await chmod(hostPath, 0o755);
            },
            catch: (cause) => ({
               code: 'launch.watchdog.prepare-failed',
               message: `Encore's resource saver could not be prepared: ${causeMessage(cause)}`
            })
         });
         if (Result.isError(copied)) return Result.err<WatchdogCommand, OperationError>(copied.error);

         return Result.ok<WatchdogCommand>({
            executablePath: 'flatpak-spawn',
            args: ['--host', hostPath, '--flatpak', flatpakId, beatSaberExecutableName, 'flatpak'],
            workingDirectory: hostDirectory
         });
      }

      const relaunchPath = process.platform === 'linux' ? (process.env.APPIMAGE ?? app.getPath('exe')) : app.getPath('exe');
      return Result.ok<WatchdogCommand>({
         executablePath: sourcePath,
         args: ['--parent', String(process.pid), beatSaberExecutableName, relaunchPath],
         workingDirectory: dirname(sourcePath)
      });
   };
}

function watchdogSourcePath() {
   const fileName = process.platform === 'win32' ? `${watchdogName}.exe` : watchdogName;
   return app.isPackaged ? join(process.resourcesPath, fileName) : join(app.getAppPath(), 'build', 'watchdog', fileName);
}
