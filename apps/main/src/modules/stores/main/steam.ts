import { Result } from 'better-result';
import { deserialize, isKvObject, type KVObject, type KVValue } from 'valve-kv';
import { z } from 'zod';

import { pathExists } from '@/lib/filesystem/path';
import type { StoreInstallCandidate } from '@/modules/stores/contract';
import { beatSaberSteamAppId, getSteamClientRoots } from '@/modules/stores/main/steam-client';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const beatSaberFolderName = 'Beat Saber';

// Steam's text VDF escapes backslashes, so keep its KeyValues checks at the file boundary
function vdfObject(value: KVValue | undefined): KVObject | null {
   return value !== undefined && isKvObject(value) ? value : null;
}

function vdfString(value: KVValue | undefined): string | null {
   const text = z.string().safeParse(value);
   return text.success ? text.data : null;
}

export async function findSteamInstalls() {
   if (process.platform !== 'win32' && process.platform !== 'linux') return [];

   const libraryFoldersPath = await findLibraryFoldersFile();
   if (!libraryFoldersPath) return [];

   const candidates: StoreInstallCandidate[] = [];
   for (const libraryPath of await readSteamLibraries(libraryFoldersPath)) {
      const manifest = await readSteamManifest(libraryPath);
      if (!manifest) continue;

      const installPath = join(libraryPath, 'steamapps', 'common', manifest.installDir ?? beatSaberFolderName);
      const exists = await pathExists(installPath);
      if (Result.isOk(exists) && exists.value) {
         candidates.push({ store: 'steam', path: installPath, libraryPath, appId: beatSaberSteamAppId });
      }
   }

   return candidates;
}

async function findLibraryFoldersFile() {
   for (const root of await getSteamClientRoots()) {
      const libraryFoldersPath = join(root, 'steamapps', 'libraryfolders.vdf');
      const exists = await pathExists(libraryFoldersPath);
      if (Result.isOk(exists) && exists.value) return libraryFoldersPath;
   }

   return null;
}

async function readSteamLibraries(libraryFoldersPath: string) {
   const parsed = await Result.tryPromise({
      try: async () => deserialize(await readFile(libraryFoldersPath, 'utf8')),
      catch: () => null
   });
   const libraryFolders = Result.isOk(parsed) ? vdfObject(parsed.value.libraryfolders) : null;
   if (!libraryFolders) return [];

   return Object.values(libraryFolders).flatMap((value) => {
      const folder = vdfObject(value);
      const path = folder ? vdfString(folder.path) : vdfString(value);
      return path ? [path] : [];
   });
}

async function readSteamManifest(libraryPath: string) {
   const manifest = await Result.tryPromise({
      try: () => readFile(join(libraryPath, 'steamapps', `appmanifest_${beatSaberSteamAppId}.acf`), 'utf8'),
      catch: () => null
   });
   if (Result.isError(manifest)) return null;

   const parsed = Result.try({
      try: () => deserialize(manifest.value),
      catch: () => null
   });

   return { installDir: Result.isOk(parsed) ? vdfString(vdfObject(parsed.value.AppState)?.installdir) : null };
}
