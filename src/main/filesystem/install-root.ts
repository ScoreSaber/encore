import { posix, win32 } from 'node:path';

export const defaultLibraryDirectoryName = 'library';

export type InstallRootPlatform = NodeJS.Platform | 'browser';

export type DefaultInstallRootOptions = {
   platform: InstallRootPlatform;
   userDataPath: string;
};

export function createDefaultInstallRoot(options: DefaultInstallRootOptions) {
   const path = options.platform === 'win32' ? win32 : posix;
   return path.join(options.userDataPath, defaultLibraryDirectoryName);
}
