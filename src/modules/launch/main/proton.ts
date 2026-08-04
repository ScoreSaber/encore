import { Result } from 'better-result';

import { createFilesystemProblem, resolveFilesystemPath, pathExists } from '@/lib/filesystem/path';
import { invalidProtonFolder, type ProtonValidation } from '@/modules/launch/contract';
import { getSteamClientRoots } from '@/modules/stores/main/steam';

import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const protonBinaryName = 'proton';
const wineBinaryPaths = [join('files', 'bin', 'wine64'), join('files', 'lib', 'wine', 'x86_64-unix', 'wine64')];

export const steamRunCommand = 'steam-run';

export const protonCompatDataDirectoryName = 'compatdata';

export type LinuxLaunchHost = {
   steamClientPath: string | null;
   nixOs: boolean;
   flatpak: boolean;
};

export async function validateProtonFolder(input: string): Promise<ProtonValidation> {
   const trimmed = input.trim();
   if (!trimmed) return invalidProtonFolder(trimmed, 'empty');
   if (!isAbsolute(trimmed)) return invalidProtonFolder(trimmed, 'not-absolute');

   const path = resolveFilesystemPath(trimmed);
   const stats = await Result.tryPromise({
      try: () => lstat(path),
      catch: (cause) => createFilesystemProblem('filesystem.path.inspect-failed', 'failed to inspect the selected Proton folder', path, cause)
   });

   if (Result.isError(stats)) return invalidProtonFolder(path, stats.error.detail === 'ENOENT' ? 'not-found' : 'inspect-failed');
   if (!stats.value.isDirectory()) return invalidProtonFolder(path, 'not-a-directory');

   const protonBinaryPath = join(path, protonBinaryName);
   const protonBinaryExists = await pathExists(protonBinaryPath);
   if (Result.isError(protonBinaryExists)) return invalidProtonFolder(path, 'inspect-failed');
   if (!protonBinaryExists.value) return invalidProtonFolder(path, 'proton-binary-missing');

   const wineBinaryPath = await findWineBinary(path);
   if (!wineBinaryPath) return invalidProtonFolder(path, 'wine-binary-missing');

   return { status: 'ok', path, protonBinaryPath, wineBinaryPath };
}

export function protonCompatDataPath(dataPath: string) {
   return join(dataPath, protonCompatDataDirectoryName);
}

export function ensureProtonCompatData(compatDataPath: string) {
   return Result.tryPromise({
      try: async () => {
         await mkdir(compatDataPath, { recursive: true });
      },
      catch: (cause) =>
         createFilesystemProblem('filesystem.operation.copy-failed', 'failed to prepare the Proton compatibility folder', compatDataPath, cause)
   });
}

export async function readLinuxLaunchHost(): Promise<LinuxLaunchHost> {
   return {
      steamClientPath: await findSteamClientPath(),
      nixOs: await isNixOs(),
      flatpak: await isFlatpak()
   };
}

async function findSteamClientPath() {
   for (const root of await getSteamClientRoots()) {
      const exists = await pathExists(root);
      if (Result.isOk(exists) && exists.value) return root;
   }

   return null;
}

async function isNixOs() {
   for (const marker of ['/etc/NIXOS', '/run/current-system/nixos-version']) {
      const exists = await pathExists(marker);
      if (Result.isOk(exists) && exists.value) return true;
   }

   return false;
}

async function isFlatpak() {
   if (process.env.FLATPAK_ID) return true;

   const exists = await pathExists('/.flatpak-info');
   return Result.isOk(exists) && exists.value;
}

async function findWineBinary(protonFolder: string) {
   for (const relativePath of wineBinaryPaths) {
      const winePath = join(protonFolder, relativePath);
      const exists = await pathExists(winePath);
      if (Result.isOk(exists) && exists.value) return winePath;
   }

   return null;
}
