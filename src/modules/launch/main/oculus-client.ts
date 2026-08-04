import { Result } from 'better-result';

import { pathExists } from '@/lib/filesystem/path';
import { queryRegistryValue } from '@/lib/windows-registry';

import { join } from 'node:path';

const oculusRegistryRoots = [
   { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Oculus VR, LLC\\Oculus', value: 'InstallLocation' },
   { key: 'HKLM\\SOFTWARE\\Oculus VR, LLC\\Oculus', value: 'InstallLocation' }
];
const defaultOculusRoot = 'C:\\Program Files\\Oculus';
const oculusClientPaths = [join('Support', 'oculus-client', 'OculusClient.exe'), 'OculusClient.exe'];

export type OculusClientState = { status: 'missing' } | { status: 'ready'; executablePath: string };

export async function readOculusClientState(): Promise<OculusClientState> {
   if (process.platform !== 'win32') return { status: 'missing' };

   for (const root of await getOculusClientRoots()) {
      for (const relativePath of oculusClientPaths) {
         const executablePath = join(root, relativePath);
         const exists = await pathExists(executablePath);

         if (Result.isOk(exists) && exists.value) return { status: 'ready', executablePath };
      }
   }

   return { status: 'missing' };
}

async function getOculusClientRoots() {
   const roots: string[] = [];

   for (const registryRoot of oculusRegistryRoots) {
      const value = await queryRegistryValue(registryRoot.key, registryRoot.value);
      if (Result.isOk(value) && value.value.value) roots.push(value.value.value);
   }

   roots.push(defaultOculusRoot);
   return [...new Set(roots)];
}
