import { Result } from 'better-result';

import { pathExists } from '@/lib/filesystem/path';
import { queryRegistryValue } from '@/lib/windows-registry';
import { getSteamClientRoots } from '@/modules/stores/main/steam';

import { join } from 'node:path';

export const beatSaberSteamAppId = '620980';
export const beatSaberSteamDepotId = '620981';

const steamExecutableName = 'steam.exe';
const activeProcessKey = 'HKCU\\SOFTWARE\\Valve\\Steam\\ActiveProcess';

export type SteamClientState =
   | { status: 'unsupported-platform' }
   | { status: 'missing' }
   | { status: 'signed-out'; root: string; executablePath: string; depotPath: string }
   | { status: 'ready'; root: string; executablePath: string; depotPath: string };

export function steamDepotPath(root: string) {
   return join(root, 'steamapps', 'content', `app_${beatSaberSteamAppId}`, `depot_${beatSaberSteamDepotId}`);
}

export async function readSteamClientState(): Promise<SteamClientState> {
   if (process.platform !== 'win32') return { status: 'unsupported-platform' };

   for (const root of await getSteamClientRoots()) {
      const executablePath = join(root, steamExecutableName);
      const exists = await pathExists(executablePath);
      if (Result.isError(exists) || !exists.value) continue;

      const status = (await hasSignedInSteamUser()) ? 'ready' : 'signed-out';
      return { status, root, executablePath, depotPath: steamDepotPath(root) };
   }

   return { status: 'missing' };
}

async function hasSignedInSteamUser() {
   const activeUser = await queryRegistryValue(activeProcessKey, 'ActiveUser');
   if (Result.isError(activeUser)) return false;

   const value = Number(activeUser.value.value);
   return Number.isFinite(value) && value !== 0;
}
