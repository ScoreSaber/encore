import { Result } from 'better-result';

import { causeCode, createProblem } from '@/lib/errors';
import { resolveFilesystemPath, pathExists } from '@/lib/filesystem/path';
import { isSteamFrame } from '@/lib/platform/steam-frame';
import type { ProtonIssue, ProtonValidation } from '@/modules/launch/contract';
import { findSteamClientRoot, openSteamLink } from '@/modules/stores/main/steam-client';

import { constants } from 'node:fs';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const protonBinaryName = 'proton';

export type LinuxLaunchHost = {
   steamClientPath: string | null;
   nixOs: boolean;
   flatpak: boolean;
   steamFrame: boolean;
};

export async function findInstalledProton(steamClientPath: string, arch: string) {
   const commonPath = join(steamClientPath, 'steamapps', 'common');
   const listed = await Result.tryPromise(() => readdir(commonPath, { withFileTypes: true }));
   if (Result.isError(listed)) return null;

   const candidates = listed.value.filter((entry) => entry.isDirectory() && entry.name.startsWith('Proton')).map((entry) => entry.name);
   const rank = (name: string) => (arch === 'arm64' && name.includes('ARM64') ? 2 : 0) + (name.includes('Experimental') ? 1 : 0);
   const ordered = candidates.toSorted((first, second) => rank(second) - rank(first) || second.localeCompare(first, undefined, { numeric: true }));
   for (const name of ordered) {
      const validation = await validateProtonFolder(join(commonPath, name));
      if (validation.status === 'ok') return validation.path;
   }
   return null;
}

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

function invalidProtonFolder(path: string, issue: ProtonIssue): ProtonValidation {
   return { status: 'invalid', path, issue };
}

export function ensureProtonCompatData(compatDataPath: string) {
   return Result.tryPromise({
      try: async () => {
         await mkdir(compatDataPath, { recursive: true });
      },
      catch: (cause) => createProblem('filesystem.operation.create-failed', { path: compatDataPath, cause })
   });
}

export async function readLinuxLaunchHost(): Promise<LinuxLaunchHost> {
   const [steamClientPath, nixOs, flatpak, steamFrame] = await Promise.all([
      findSteamClientRoot(),
      isNixOs(),
      isFlatpak(),
      Promise.resolve(isSteamFrame())
   ]);
   return { steamClientPath, nixOs, flatpak, steamFrame };
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

const steamProtonAppIds = { arm64: '4628740', other: '1493710' };

export function requestSteamProton(arch: string) {
   return openSteamLink(`steam://install/${arch === 'arm64' ? steamProtonAppIds.arm64 : steamProtonAppIds.other}`);
}

export async function ensureSteamProton(protonPath: string | null, arch: string) {
   if (process.platform !== 'linux') return false;
   if (protonPath && (await validateProtonFolder(protonPath)).status === 'ok') return false;
   const host = await readLinuxLaunchHost();
   if (!host.steamFrame || !host.steamClientPath || (await findInstalledProton(host.steamClientPath, arch))) return false;
   return requestSteamProton(arch);
}
