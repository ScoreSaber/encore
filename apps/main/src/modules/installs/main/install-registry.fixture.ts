import { Result } from 'better-result';
import { onTestFinished } from 'vite-plus/test';

import type { InstallSource } from '@/modules/installs/contract';
import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreInstallCandidate } from '@/modules/stores/contract';
import { createAppLogWriter } from '@/modules/support/main/app-log';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createInstallTestbed(options: { platform?: NodeJS.Platform } = {}) {
   const platform = options.platform ?? 'linux';
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-test-'));
   const installRoot = join(dataPath, 'library');
   await mkdir(installRoot, { recursive: true });

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform, arch: 'x64' });
   await settingsStore.updateLibrarySettings({ installRoot });
   let candidates: StoreInstallCandidate[] = [];
   const registry = createInstallRegistry({
      dataPath,
      settingsStore,
      detectStores: () => Promise.resolve(candidates)
   });

   onTestFinished(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      installRoot,
      settingsStore,
      registry,
      operations: createOperationRegistry(),
      log: createAppLogWriter({ logsPath: join(dataPath, 'logs') }),
      setCandidates: (next: StoreInstallCandidate[]) => {
         candidates = next;
      },
      register: async (path: string, source: InstallSource = 'library') => {
         const registered = await registry.register({ source, path });
         if (Result.isError(registered)) throw new Error('registration failed');

         return registered.value;
      }
   };
}

export async function writeInstallFolder(installPath: string, version = '1.37.0') {
   await mkdir(join(installPath, 'Beat Saber_Data'), { recursive: true });
   await writeFile(join(installPath, 'Beat Saber.exe'), 'stub', 'utf8');
   await writeFile(join(installPath, 'Beat Saber_Data', 'globalgamemanagers'), `public.app-category.games  ${version} `, 'latin1');

   return installPath;
}
