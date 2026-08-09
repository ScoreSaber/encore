import { Result } from 'better-result';

import { causeCode } from '@/lib/errors';
import { createFilesystemProblem, resolveFilesystemPath, pathExists } from '@/lib/filesystem/path';
import { invalidProtonFolder, type ProtonValidation } from '@/modules/launch/contract';
import { getSteamClientRoots } from '@/modules/stores/main/steam';

import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const protonBinaryName = 'proton';

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
      try: () => stat(path),
      catch: causeCode
   });

   if (Result.isError(stats)) return invalidProtonFolder(path, stats.error === 'ENOENT' ? 'not-found' : 'inspect-failed');
   if (!stats.value.isDirectory()) return invalidProtonFolder(path, 'not-a-directory');

   const protonBinaryPath = join(path, protonBinaryName);
   const protonBinary = await Result.tryPromise({
      try: () => stat(protonBinaryPath),
      catch: causeCode
   });
   if (Result.isError(protonBinary)) {
      return invalidProtonFolder(path, protonBinary.error === 'ENOENT' ? 'proton-binary-missing' : 'inspect-failed');
   }
   if (!protonBinary.value.isFile()) return invalidProtonFolder(path, 'proton-binary-missing');

   const executable = await Result.tryPromise({
      try: () => access(protonBinaryPath, constants.X_OK),
      catch: causeCode
   });
   if (Result.isError(executable)) return invalidProtonFolder(path, 'proton-binary-not-executable');

   return { status: 'ok', path, protonBinaryPath };
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
   const [steamClientPath, nixOs, flatpak] = await Promise.all([findSteamClientPath(), isNixOs(), isFlatpak()]);
   return { steamClientPath, nixOs, flatpak };
}

async function findSteamClientPath() {
   for (const root of await getSteamClientRoots()) {
      const exists = await pathExists(root);
      if (Result.isOk(exists) && exists.value) return root;
   }

   return null;
}

async function isNixOs() {
   for (const marker of ['/etc/NIXOS', '/run/current-system/nixos-version', '/run/host/etc/NIXOS', '/run/host/run/current-system/nixos-version']) {
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
