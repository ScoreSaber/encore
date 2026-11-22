import { Result } from 'better-result';

import { pathExists } from '@/lib/filesystem/path';
import { queryRegistryValue } from '@/lib/windows-registry';

import { spawn } from 'node:child_process';
import { readFile, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const beatSaberSteamAppId = '620980';
export const beatSaberSteamDepotId = '620981';

const steamExecutableName = 'steam.exe';
const linuxSteamBootstrapper = '/usr/bin/steam';
const activeProcessKey = 'HKCU\\SOFTWARE\\Valve\\Steam\\ActiveProcess';
const steamRegistryRoots = [
   { key: 'HKCU\\Software\\Valve\\Steam', value: 'SteamPath' },
   { key: 'HKLM\\SOFTWARE\\Valve\\Steam', value: 'InstallPath' },
   { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', value: 'InstallPath' }
];

export type SteamClientState =
   | { status: 'unsupported-platform' }
   | { status: 'missing' }
   | { status: 'signed-out' | 'ready'; executablePath: string; depotPath: string };

export async function getSteamClientRoots() {
   return process.platform === 'win32' ? getWindowsSteamRoots() : getLinuxSteamRoots();
}

export async function findSteamClientRoot() {
   for (const root of await getSteamClientRoots()) {
      const exists = await pathExists(root);
      if (Result.isOk(exists) && exists.value) return root;
   }

   return null;
}

export async function readSteamClientState(): Promise<SteamClientState> {
   if (process.platform === 'linux') return readLinuxSteamClientState();
   if (process.platform !== 'win32') return { status: 'unsupported-platform' };

   for (const root of await getSteamClientRoots()) {
      const executablePath = join(root, steamExecutableName);
      const exists = await pathExists(executablePath);
      if (Result.isError(exists) || !exists.value) continue;

      return { status: (await hasSignedInSteamUser()) ? 'ready' : 'signed-out', executablePath, depotPath: depotPathIn(root) };
   }

   return { status: 'missing' };
}

async function readLinuxSteamClientState(): Promise<SteamClientState> {
   const root = await findSteamClientRoot();
   if (!root) return { status: 'missing' };

   const bootstrapper = await pathExists(linuxSteamBootstrapper);
   const executablePath = Result.isOk(bootstrapper) && bootstrapper.value ? linuxSteamBootstrapper : join(root, 'steam.sh');
   const pid = await Result.tryPromise(() => readFile(join(homedir(), '.steam', 'steam.pid'), 'utf8'));
   const client = Result.isOk(pid) ? await Result.tryPromise(() => readlink(`/proc/${pid.value.trim()}/exe`)) : null;
   if (!client || Result.isError(client)) return { status: 'signed-out', executablePath, depotPath: depotPathIn(join(root, 'ubuntu12_32')) };

   return { status: 'ready', executablePath, depotPath: depotPathIn(dirname(client.value)) };
}

function depotPathIn(directory: string) {
   return join(directory, 'steamapps', 'content', `app_${beatSaberSteamAppId}`, `depot_${beatSaberSteamDepotId}`);
}

async function hasSignedInSteamUser() {
   const activeUser = await queryRegistryValue(activeProcessKey, 'ActiveUser');
   if (Result.isError(activeUser)) return false;

   const value = Number(activeUser.value.value);
   return Number.isFinite(value) && value !== 0;
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

export async function openSteamLink(link: string) {
   const steam = await readSteamClientState();
   if (steam.status !== 'ready') return false;
   const child = spawn(steam.executablePath, [link], { detached: true, stdio: 'ignore' });
   child.once('error', () => undefined);
   child.unref();
   return true;
}
