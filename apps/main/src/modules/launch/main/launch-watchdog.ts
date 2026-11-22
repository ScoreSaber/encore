import { Result } from 'better-result';
import { app } from 'electron';

import { createProblem } from '@/lib/errors';
import { beatSaberExecutableName } from '@/modules/installs/main/beat-saber-files';
import type { PrepareLaunchWatchdog } from '@/modules/launch/main/launch-runtime';

import { constants } from 'node:fs';
import { access, copyFile, chmod, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const watchdogName = 'encore-watchdog';

export function createLaunchWatchdog(dataPath: string): PrepareLaunchWatchdog {
   return async () => {
      const fileName = process.platform === 'win32' ? `${watchdogName}.exe` : watchdogName;
      const sourcePath = app.isPackaged ? join(process.resourcesPath, fileName) : join(app.getAppPath(), 'build', 'watchdog', fileName);
      const flatpakId = process.env.FLATPAK_ID;
      const available = await Result.tryPromise({
         try: () => access(sourcePath, constants.X_OK),
         catch: (cause) => createProblem('launch.watchdog.unavailable', { cause })
      });
      if (Result.isError(available)) return Result.err(available.error);

      if (process.platform === 'linux' && flatpakId) {
         const hostDirectory = join(dataPath, 'watchdog');
         const hostPath = join(hostDirectory, watchdogName);
         const copied = await Result.tryPromise({
            try: async () => {
               await mkdir(hostDirectory, { recursive: true });
               await copyFile(sourcePath, hostPath);
               await chmod(hostPath, 0o755);
            },
            catch: (cause) => createProblem('launch.watchdog.prepare-failed', { cause })
         });
         if (Result.isError(copied)) return Result.err(copied.error);

         return Result.ok({
            executablePath: 'flatpak-spawn',
            args: ['--host', hostPath, '--flatpak', flatpakId, beatSaberExecutableName, 'flatpak'],
            workingDirectory: hostDirectory
         });
      }

      const relaunchPath = process.platform === 'linux' ? (process.env.APPIMAGE ?? app.getPath('exe')) : app.getPath('exe');
      return Result.ok({
         executablePath: sourcePath,
         args: ['--parent', String(process.pid), beatSaberExecutableName, relaunchPath],
         workingDirectory: dirname(sourcePath)
      });
   };
}
