import { Result } from 'better-result';

import { pathExists, readPathInfo } from '@/lib/filesystem/path';
import { queryRegistryKey } from '@/lib/windows-registry';
import type { StoreInstallCandidate } from '@/modules/stores/contract';

import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const oculusLibrariesKey = 'HKCU\\SOFTWARE\\Oculus VR, LLC\\Oculus\\Libraries';
const beatSaberFolderName = 'hyperbolic-magnetism-beat-saber';

export async function findOculusInstalls() {
   if (process.platform !== 'win32') return [];

   const candidates: StoreInstallCandidate[] = [];
   for (const libraryPath of await readOculusLibraryPaths()) {
      const installPath = win32.join(libraryPath, 'Software', beatSaberFolderName);
      const exists = await pathExists(installPath);
      if (Result.isError(exists) || !exists.value) continue;

      const info = await readPathInfo(installPath);
      if (Result.isError(info) || info.value.kind !== 'directory' || info.value.isLink) continue;

      candidates.push({ store: 'oculus', path: installPath, libraryPath });
   }

   return candidates;
}

async function readOculusLibraryPaths() {
   const root = await queryRegistryKey(oculusLibrariesKey);
   if (Result.isError(root)) return [];

   const paths: string[] = [];
   for (const subkey of root.value.subkeys) {
      const library = await queryRegistryKey(subkey);
      if (Result.isError(library)) continue;

      const path = await readOculusLibraryPath(library.value.values);
      if (path) paths.push(path);
   }

   return paths;
}

async function readOculusLibraryPath(values: { name: string; value: string }[]) {
   const originalPath = values.find((value) => value.name === 'OriginalPath')?.value;
   if (originalPath) return originalPath;

   const path = values.find((value) => value.name === 'Path')?.value;
   if (!path) return null;

   return path.startsWith('\\\\?\\Volume{') ? resolveVolumeGuidPath(path) : path;
}

async function resolveVolumeGuidPath(guidPath: string) {
   const guidRoot = win32.parse(guidPath).root;
   const relativePath = win32.relative(guidRoot, guidPath);
   const driveLetter = await Result.tryPromise({
      try: async () => {
         const script = [
            '$deviceId = $args[0]',
            '$volume = Get-CimInstance -ClassName Win32_Volume | Where-Object { $_.DeviceID -eq $deviceId } | Select-Object -First 1',
            'if ($null -ne $volume -and $volume.DriveLetter) { Write-Output $volume.DriveLetter }'
         ].join('; ');
         const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script, guidRoot], { windowsHide: true });
         return result.stdout.trim();
      },
      catch: () => null
   });

   if (Result.isError(driveLetter) || !driveLetter.value) return null;

   return win32.join(driveLetter.value, relativePath);
}
