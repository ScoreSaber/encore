import { Result } from 'better-result';
import { app } from 'electron';

import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const backgroundLaunchFlag = '--background';

const run = promisify(execFile);

export async function trayHostAvailable(platform: NodeJS.Platform) {
   if (platform !== 'linux') return true;

   const owner = await Result.tryPromise(() =>
      run(
         'gdbus',
         [
            'call',
            '--session',
            '--dest',
            'org.freedesktop.DBus',
            '--object-path',
            '/org/freedesktop/DBus',
            '--method',
            'org.freedesktop.DBus.NameHasOwner',
            'org.kde.StatusNotifierWatcher'
         ],
         { timeout: 3_000 }
      )
   );
   return Result.isError(owner) || owner.value.stdout.includes('true');
}

export function createLoginItem(options: { platform: NodeJS.Platform; packaged: boolean; configPath: string; command: string }) {
   const autostartPath = join(options.configPath, 'autostart', 'encore.desktop');

   async function apply(enabled: boolean) {
      if (!options.packaged) return;
      if (options.platform === 'win32') {
         app.setLoginItemSettings({ openAtLogin: enabled, args: [backgroundLaunchFlag] });
         return;
      }
      if (options.platform !== 'linux') return;

      if (!enabled) {
         await rm(autostartPath, { force: true });
         return;
      }
      await mkdir(join(options.configPath, 'autostart'), { recursive: true });
      await writeFile(
         autostartPath,
         [
            '[Desktop Entry]',
            'Type=Application',
            'Name=Encore',
            `Exec=${options.command} ${backgroundLaunchFlag}`,
            'X-GNOME-Autostart-enabled=true',
            ''
         ].join('\n'),
         'utf8'
      );
   }

   return { apply };
}
