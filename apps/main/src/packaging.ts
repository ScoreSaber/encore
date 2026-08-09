import type { AppPackaging, PackageFormat } from '@/modules/app/contract';
import { playlistFileExtension } from '@/modules/playlists/contract';
import { encoreProtocol } from '@/modules/shortcuts/contract';

export const packagedProtocolSchemes = [encoreProtocol];
export const packagedFileAssociations = [playlistFileExtension];

type PackageEnvironment = {
   packaged: boolean;
   platform: NodeJS.Platform;
   env: NodeJS.ProcessEnv;
};

function detectPackageFormat({ packaged, platform, env }: PackageEnvironment): PackageFormat {
   if (!packaged) return 'development';
   if (platform === 'win32') return 'nsis';
   if (platform === 'darwin') return 'macos';
   if (platform !== 'linux') return 'unknown';
   if (env.FLATPAK_ID) return 'flatpak';

   return env.APPIMAGE ? 'appimage' : 'linux-package';
}

export function createAppPackaging(environment: PackageEnvironment): AppPackaging {
   const format = detectPackageFormat(environment);
   // unsigned macOS builds can check for updates but Squirrel cannot install them
   const selfUpdates = format === 'appimage' || format === 'nsis';

   return {
      packaged: environment.packaged,
      format,
      selfUpdates,
      updateChecks: selfUpdates || format === 'macos',
      protocols: packagedProtocolSchemes,
      fileAssociations: packagedFileAssociations
   };
}
