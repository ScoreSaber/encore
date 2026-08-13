import { Result, type Result as BetterResult } from 'better-result';
import { deserialize, isKvObject, type KVObject, type KVValue } from 'valve-kv';
import { z } from 'zod';

import { causeCode } from '@/lib/errors';
import { pathExists } from '@/lib/filesystem/path';
import { queryRegistryValue } from '@/lib/windows-registry';
import type {
   StoreDetectionDiagnostic,
   StoreDetectionStoreSummary,
   StoreInstallCandidate,
   StoreKind,
   StoreLibrarySummary
} from '@/modules/stores/contract';
import type { TargetId } from '@/modules/targets/contract';

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const steamStore: StoreKind = 'steam';
const beatSaberAppId = '620980';
const beatSaberFolderName = 'Beat Saber';
const beatSaberExecutableName = 'Beat Saber.exe';
const libraryFoldersFile = 'libraryfolders.vdf';
const parseVdf = deserialize;
const steamRegistryRoots = [
   {
      key: 'HKCU\\Software\\Valve\\Steam',
      value: 'SteamPath'
   },
   {
      key: 'HKLM\\SOFTWARE\\Valve\\Steam',
      value: 'InstallPath'
   },
   {
      key: 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
      value: 'InstallPath'
   }
];

type SteamDetectionResult = {
   store: StoreDetectionStoreSummary;
   candidates: StoreInstallCandidate[];
};

// Steam's text VDF escapes backslashes, so keep its KeyValues checks at the file boundary
function vdfObject(value: KVValue | undefined): KVObject | null {
   return value !== undefined && isKvObject(value) ? value : null;
}

function vdfString(value: KVValue | undefined): string | null {
   const text = z.string().safeParse(value);
   return text.success ? text.data : null;
}

type SteamLibrary = {
   id: string;
   path: string;
   hasBeatSaberApp: boolean;
};

type SteamManifest = {
   path: string;
   installDir: string | null;
};

type SteamRoot = {
   root: string;
   libraryFoldersPath: string;
};

type SteamRootProblem = {
   code: 'steam.libraryfolders-missing' | 'steam.libraryfolders-read-failed' | 'steam.root-missing';
   status: 'error' | 'missing';
   severity: 'error' | 'info' | 'warning';
   path?: string;
   detail?: string;
   clientPath?: string;
};

export async function detectSteamStore(targetId: TargetId): Promise<SteamDetectionResult> {
   if (process.platform !== 'win32' && process.platform !== 'linux') {
      const diagnostic = steamDiagnostic('steam.unsupported-platform', 'info');

      return {
         store: {
            store: steamStore,
            status: 'unsupported',
            libraries: [],
            diagnostics: [diagnostic]
         },
         candidates: []
      };
   }

   const rootResult = await findSteamRoot();
   if (Result.isError(rootResult)) {
      const diagnostic = steamDiagnostic(rootResult.error.code, rootResult.error.severity, rootResult.error.path, rootResult.error.detail);
      const store: StoreDetectionStoreSummary = {
         store: steamStore,
         status: rootResult.error.status,
         libraries: [],
         diagnostics: [diagnostic]
      };
      if (rootResult.error.clientPath) store.clientPath = rootResult.error.clientPath;

      return {
         store,
         candidates: []
      };
   }

   const libraryResult = await readSteamLibraries(rootResult.value.libraryFoldersPath);
   if (Result.isError(libraryResult)) {
      const diagnostic = steamDiagnostic('steam.libraryfolders-read-failed', 'error', rootResult.value.libraryFoldersPath, libraryResult.error);

      return {
         store: {
            store: steamStore,
            status: 'error',
            libraries: [],
            diagnostics: [diagnostic],
            clientPath: rootResult.value.root
         },
         candidates: []
      };
   }

   const diagnostics: StoreDetectionDiagnostic[] = [];
   const libraries: StoreLibrarySummary[] = [];
   const candidates: StoreInstallCandidate[] = [];

   for (const library of libraryResult.value) {
      const manifest = await readSteamManifest(library.path);
      const installPath = await findSteamInstallPath(library, manifest);
      const executablePath = installPath ? await findSteamExecutable(installPath) : null;
      const hasBeatSaber = Boolean(installPath);

      const summary: StoreLibrarySummary = {
         id: library.id,
         store: steamStore,
         path: library.path,
         hasBeatSaber
      };
      if (manifest) summary.manifestPath = manifest.path;
      if (installPath) summary.installPath = installPath;
      libraries.push(summary);

      if (!installPath) continue;

      const candidate: StoreInstallCandidate = {
         id: `${targetId}:steam:${installPath}`,
         targetId,
         store: steamStore,
         path: installPath,
         libraryPath: library.path,
         appId: beatSaberAppId
      };
      if (manifest) candidate.manifestPath = manifest.path;
      if (executablePath) candidate.executablePath = executablePath;

      candidates.push(candidate);
      diagnostics.push(steamDiagnostic('steam.detected', 'info', installPath));
   }

   if (candidates.length === 0) {
      diagnostics.push(steamDiagnostic('steam.beat-saber-missing', 'info', rootResult.value.root));
   }

   return {
      store: {
         store: steamStore,
         status: candidates.length > 0 ? 'detected' : 'missing',
         libraries,
         diagnostics,
         clientPath: rootResult.value.root
      },
      candidates
   };
}

export async function getSteamClientRoots() {
   return process.platform === 'win32' ? getWindowsSteamRoots() : getLinuxSteamRoots();
}

async function findSteamRoot(): Promise<BetterResult<SteamRoot, SteamRootProblem>> {
   const roots = await getSteamClientRoots();
   let firstExistingRoot: string | null = null;

   for (const root of roots) {
      const libraryFoldersPath = join(root, 'steamapps', libraryFoldersFile);
      const libraryFoldersExists = await pathExists(libraryFoldersPath);

      if (Result.isError(libraryFoldersExists)) {
         return Result.err<SteamRoot, SteamRootProblem>({
            code: 'steam.libraryfolders-read-failed',
            status: 'error',
            severity: 'error',
            path: libraryFoldersPath,
            detail: libraryFoldersExists.error.detail,
            clientPath: root
         });
      }

      if (libraryFoldersExists.value) {
         return Result.ok<SteamRoot, SteamRootProblem>({
            root,
            libraryFoldersPath
         });
      }

      const rootExists = await pathExists(root);
      if (Result.isOk(rootExists) && rootExists.value && !firstExistingRoot) firstExistingRoot = root;
   }

   if (firstExistingRoot) {
      return Result.err<SteamRoot, SteamRootProblem>({
         code: 'steam.libraryfolders-missing',
         status: 'missing',
         severity: 'warning',
         path: join(firstExistingRoot, 'steamapps', libraryFoldersFile),
         clientPath: firstExistingRoot
      });
   }

   return Result.err<SteamRoot, SteamRootProblem>({
      code: 'steam.root-missing',
      status: 'missing',
      severity: 'info'
   });
}

async function getWindowsSteamRoots() {
   const roots: string[] = [];

   for (const registryRoot of steamRegistryRoots) {
      const value = await queryRegistryValue(registryRoot.key, registryRoot.value);
      if (Result.isOk(value) && value.value.value) roots.push(value.value.value);
   }

   roots.push(join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Steam'));

   return [...new Set(roots)];
}

function getLinuxSteamRoots() {
   const home = homedir();

   return [
      join(home, '.steam', 'steam'),
      join(home, '.steam', 'root'),
      join(home, '.local', 'share', 'Steam'),
      join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
      join(home, 'snap', 'steam', 'common', '.local', 'share', 'Steam')
   ];
}

async function readSteamLibraries(libraryFoldersPath: string) {
   const contents = await Result.tryPromise({
      try: () => readFile(libraryFoldersPath, 'utf8'),
      catch: (cause) => causeCode(cause)
   });

   if (Result.isError(contents)) return Result.err<SteamLibrary[], string>(contents.error);

   const parsed = Result.try({
      try: () => parseVdf(contents.value),
      catch: (cause) => causeCode(cause)
   });

   if (Result.isError(parsed)) return Result.err<SteamLibrary[], string>(parsed.error);

   const libraryFolders = vdfObject(parsed.value.libraryfolders);
   if (!libraryFolders) return Result.ok<SteamLibrary[], string>([]);

   return Result.ok<SteamLibrary[], string>(
      Object.entries(libraryFolders).flatMap(([id, value]) => {
         const folder = vdfObject(value);
         const path = folder ? vdfString(folder.path) : vdfString(value);
         if (!path) return [];

         const apps = folder ? vdfObject(folder.apps) : null;

         return [
            {
               id,
               path,
               hasBeatSaberApp: Boolean(apps?.[beatSaberAppId])
            }
         ];
      })
   );
}

async function readSteamManifest(libraryPath: string): Promise<SteamManifest | null> {
   const manifestPath = join(libraryPath, 'steamapps', `appmanifest_${beatSaberAppId}.acf`);
   const exists = await pathExists(manifestPath);
   if (Result.isError(exists) || !exists.value) return null;

   const contents = await Result.tryPromise({
      try: () => readFile(manifestPath, 'utf8'),
      catch: () => null
   });

   if (Result.isError(contents)) return null;

   const parsed = Result.try({
      try: () => parseVdf(contents.value),
      catch: () => null
   });

   if (Result.isError(parsed)) {
      return {
         path: manifestPath,
         installDir: null
      };
   }

   const appState = vdfObject(parsed.value.AppState);

   return {
      path: manifestPath,
      installDir: vdfString(appState?.installdir)
   };
}

async function findSteamInstallPath(library: SteamLibrary, manifest: SteamManifest | null) {
   if (!library.hasBeatSaberApp && !manifest) return null;

   const installPath = join(library.path, 'steamapps', 'common', manifest?.installDir ?? beatSaberFolderName);
   const exists = await pathExists(installPath);

   return Result.isOk(exists) && exists.value ? installPath : null;
}

async function findSteamExecutable(installPath: string) {
   const executablePath = join(installPath, beatSaberExecutableName);
   const exists = await pathExists(executablePath);

   return Result.isOk(exists) && exists.value ? executablePath : null;
}

function steamDiagnostic(
   code: StoreDetectionDiagnostic['code'],
   severity: StoreDetectionDiagnostic['severity'],
   path?: string,
   detail?: string
): StoreDetectionDiagnostic {
   const diagnostic: StoreDetectionDiagnostic = {
      id: [steamStore, code, path].filter(Boolean).join(':'),
      store: steamStore,
      code,
      severity
   };
   if (path) diagnostic.path = path;
   if (detail) diagnostic.detail = detail;
   return diagnostic;
}
