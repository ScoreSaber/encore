import { Result } from 'better-result';

import { causeCode, createProblem } from '@/lib/errors';
import { resolveFilesystemPath, pathExists } from '@/lib/filesystem/path';
import { isSteamFrame } from '@/lib/platform/steam-frame';
import type { ProtonIssue, ProtonValidation } from '@/modules/launch/contract';
import { readSteamLibraryPaths } from '@/modules/stores/main/steam';
import { findSteamClientRoot, openSteamLink } from '@/modules/stores/main/steam-client';

import { constants } from 'node:fs';
import { access, mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const protonBinaryName = 'proton';
const arm64WineBinarySegments = ['files', 'bin-arm64', 'wine'];

export type LinuxLaunchHost = {
   steamClientPath: string | null;
   nixOs: boolean;
   flatpak: boolean;
   steamFrame: boolean;
   reaperPath: string | null;
};

export async function findInstalledProton(steamClientPath: string, arch: string) {
   const libraries = await readSteamLibraryPaths(steamClientPath);
   const candidates: { name: string; path: string }[] = [];

   for (const libraryPath of libraries) {
      const commonPath = join(libraryPath, 'steamapps', 'common');
      const listed = await Result.tryPromise(() => readdir(commonPath, { withFileTypes: true }));
      if (Result.isError(listed)) continue;

      for (const entry of listed.value) {
         if (entry.isDirectory() && entry.name.startsWith('Proton')) {
            candidates.push({ name: entry.name, path: join(commonPath, entry.name) });
         }
      }
   }

   const rank = (name: string) => (arch === 'arm64' && name.includes('ARM64') ? 2 : 0) + (name.includes('Experimental') ? 1 : 0);
   const ordered = candidates.toSorted(
      (first, second) => rank(second.name) - rank(first.name) || second.name.localeCompare(first.name, undefined, { numeric: true })
   );
   for (const candidate of ordered) {
      const validation = await validateProtonFolder(candidate.path, arch);
      if (validation.status === 'ok') return validation.path;
   }
   return null;
}

export async function validateProtonFolder(input: string, arch?: string): Promise<ProtonValidation> {
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

   if (arch === 'arm64' && !(await isExecutableFile(join(path, ...arm64WineBinarySegments)))) {
      return invalidProtonFolder(path, 'proton-arm64-required');
   }

   return { status: 'ok', path, protonBinaryPath };
}

async function findSteamReaper(steamClientPath: string, arch: string) {
   const directories = arch === 'arm64' ? ['steamrtarm64', 'ubuntu12_32'] : ['ubuntu12_32', 'steamrtarm64'];
   for (const directory of directories) {
      const candidate = join(steamClientPath, directory, 'reaper');
      if (await isExecutableFile(candidate)) return candidate;
   }
   return null;
}

async function isExecutableFile(filePath: string) {
   const stats = await Result.tryPromise(() => stat(filePath));
   if (Result.isError(stats) || !stats.value.isFile()) return false;

   const executable = await Result.tryPromise(() => access(filePath, constants.X_OK));
   return Result.isOk(executable);
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
   const reaperPath = steamClientPath ? await findSteamReaper(steamClientPath, process.arch) : null;
   return { steamClientPath, nixOs, flatpak, steamFrame, reaperPath };
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
   if (protonPath && (await validateProtonFolder(protonPath, arch)).status === 'ok') return false;
   const host = await readLinuxLaunchHost();
   if (!host.steamFrame || !host.steamClientPath || (await findInstalledProton(host.steamClientPath, arch))) return false;
   return requestSteamProton(arch);
}
