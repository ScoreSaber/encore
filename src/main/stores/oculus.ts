import { Result, type Result as BetterResult } from 'better-result';

import { pathExists, readPathInfo } from '@/main/filesystem/path-helpers';
import { queryRegistryKey } from '@/main/stores/windows-registry';
import type {
   StoreDetectionDiagnostic,
   StoreDetectionStoreSummary,
   StoreInstallCandidate,
   StoreKind,
   StoreLibrarySummary,
   TargetId
} from '@/shared/targets';

import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const oculusStore: StoreKind = 'oculus';
const oculusLibrariesKey = 'HKCU\\SOFTWARE\\Oculus VR, LLC\\Oculus\\Libraries';
const beatSaberFolderName = 'hyperbolic-magnetism-beat-saber';
const beatSaberExecutableName = 'Beat Saber.exe';

type OculusDetectionResult = {
   store: StoreDetectionStoreSummary;
   candidates: StoreInstallCandidate[];
};

type OculusLibrary = {
   id: string;
   path: string;
   isDefault: boolean;
};

type OculusLibrariesProblem = {
   code: 'oculus.libraries-missing' | 'oculus.registry-read-failed';
   status: 'error' | 'missing';
   severity: 'error' | 'info';
   path: string;
   detail?: string;
};

export async function detectOculusStore(targetId: TargetId): Promise<OculusDetectionResult> {
   if (process.platform !== 'win32') {
      const diagnostic = oculusDiagnostic('oculus.unsupported-platform', 'info');

      return {
         store: {
            store: oculusStore,
            status: 'unsupported',
            libraries: [],
            diagnostics: [diagnostic]
         },
         candidates: []
      };
   }

   const libraries = await readOculusLibraries();
   if (Result.isError(libraries)) {
      const diagnostic = oculusDiagnostic(libraries.error.code, libraries.error.severity, libraries.error.path, libraries.error.detail);

      return {
         store: {
            store: oculusStore,
            status: libraries.error.status,
            libraries: [],
            diagnostics: [diagnostic]
         },
         candidates: []
      };
   }

   const summaries: StoreLibrarySummary[] = [];
   const diagnostics: StoreDetectionDiagnostic[] = [];
   const candidates: StoreInstallCandidate[] = [];

   for (const library of libraries.value) {
      const installPath = await findOculusInstallPath(library.path);
      const executablePath = installPath ? await findOculusExecutable(installPath) : null;

      summaries.push({
         id: library.id,
         store: oculusStore,
         path: library.path,
         isDefault: library.isDefault,
         hasBeatSaber: Boolean(installPath),
         ...(installPath ? { installPath } : {})
      });

      if (!installPath) continue;

      const candidate: StoreInstallCandidate = {
         id: `${targetId}:oculus:${installPath}`,
         targetId,
         store: oculusStore,
         path: installPath,
         libraryPath: library.path,
         ...(executablePath ? { executablePath } : {}),
         isReadOnly: true,
         isProtected: true
      };

      candidates.push(candidate);
      diagnostics.push(oculusDiagnostic('oculus.detected', 'info', installPath));
   }

   if (candidates.length === 0) {
      diagnostics.push(oculusDiagnostic('oculus.beat-saber-missing', 'info'));
   }

   return {
      store: {
         store: oculusStore,
         status: candidates.length > 0 ? 'detected' : 'missing',
         libraries: summaries,
         diagnostics
      },
      candidates
   };
}

async function readOculusLibraries(): Promise<BetterResult<OculusLibrary[], OculusLibrariesProblem>> {
   const root = await queryRegistryKey(oculusLibrariesKey);

   if (Result.isError(root)) {
      return Result.err<OculusLibrary[], OculusLibrariesProblem>({
         code: root.error.code === 'registry.missing' ? 'oculus.libraries-missing' : 'oculus.registry-read-failed',
         status: root.error.code === 'registry.missing' ? 'missing' : 'error',
         severity: root.error.code === 'registry.missing' ? 'info' : 'error',
         path: oculusLibrariesKey,
         detail: root.error.detail
      });
   }

   if (root.value.subkeys.length === 0) {
      return Result.err<OculusLibrary[], OculusLibrariesProblem>({
         code: 'oculus.libraries-missing',
         status: 'missing',
         severity: 'info',
         path: oculusLibrariesKey
      });
   }

   const defaultLibraryId = root.value.values.find((value) => value.name === 'DefaultLibrary')?.value;
   const libraries: OculusLibrary[] = [];

   for (const subkey of root.value.subkeys) {
      const library = await queryRegistryKey(subkey);
      if (Result.isError(library)) continue;

      const libraryPath = await readOculusLibraryPath(library.value.values);
      if (!libraryPath) continue;

      const id = subkey.slice(subkey.lastIndexOf('\\') + 1);
      libraries.push({
         id,
         path: libraryPath,
         isDefault: id === defaultLibraryId
      });
   }

   if (libraries.length === 0) {
      return Result.err<OculusLibrary[], OculusLibrariesProblem>({
         code: 'oculus.libraries-missing',
         status: 'missing',
         severity: 'info',
         path: oculusLibrariesKey
      });
   }

   return Result.ok<OculusLibrary[], OculusLibrariesProblem>(libraries);
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

async function findOculusInstallPath(libraryPath: string) {
   const installPath = win32.join(libraryPath, 'Software', beatSaberFolderName);
   const exists = await pathExists(installPath);
   if (Result.isError(exists) || !exists.value) return null;

   const info = await readPathInfo(installPath);
   if (Result.isError(info) || info.value.kind !== 'directory' || info.value.isLink) return null;

   return installPath;
}

async function findOculusExecutable(installPath: string) {
   const executablePath = win32.join(installPath, beatSaberExecutableName);
   const exists = await pathExists(executablePath);

   return Result.isOk(exists) && exists.value ? executablePath : null;
}

function oculusDiagnostic(
   code: StoreDetectionDiagnostic['code'],
   severity: StoreDetectionDiagnostic['severity'],
   path?: string,
   detail?: string
): StoreDetectionDiagnostic {
   return {
      id: [oculusStore, code, path].filter(Boolean).join(':'),
      store: oculusStore,
      code,
      severity,
      ...(path ? { path } : {}),
      ...(detail ? { detail } : {})
   };
}
