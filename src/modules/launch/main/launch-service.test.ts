import { Result } from 'better-result';

import { createInstallRegistry } from '@/modules/installs/main/install-registry';
import type { LaunchOptions } from '@/modules/launch/contract';
import { buildProtonCommand } from '@/modules/launch/main/launch-options';
import { quoteForPowerShell, type LaunchCommand, type LaunchRuntime, type WatchdogCommand } from '@/modules/launch/main/launch-runtime';
import { createLaunchService } from '@/modules/launch/main/launch-service';
import { ensureProtonCompatData, validateProtonFolder } from '@/modules/launch/main/proton';
import { createOperationRegistry } from '@/modules/operations/main/operation-registry';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';
import { createSettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreDetectionSnapshot } from '@/modules/stores/contract';

import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
   for (const cleanup of cleanups.reverse()) {
      await cleanup();
   }
   cleanups.length = 0;
});

describe('launch service', () => {
   test('builds argv entries instead of a shell string and records the last launch', async () => {
      const harness = await createHarness();
      const install = await harness.createInstall();
      const options: LaunchOptions = {
         flags: ['debug', 'fpfc'],
         args: ['--room', 'my room', '--seed', '7'],
         runAsAdmin: false,
         closeEncore: false
      };

      const started = await harness.launch.start({ installId: install.id, options });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ status: 'completed' });
      expect(harness.spawned).toEqual([
         expect.objectContaining({
            executablePath: join(install.path, 'Beat Saber.exe'),
            args: ['--no-yeet', 'fpfc', '--verbose', '--room', 'my room', '--seed', '7'],
            runAsAdmin: false
         })
      ]);
      expect((await harness.launch.getState()).lastLaunch).toMatchObject({
         installId: install.id,
         options: { flags: ['fpfc', 'debug'], args: ['--room', 'my room', '--seed', '7'] }
      });
      expect(harness.watchdogs).toEqual([]);
   });

   test('starts the resource saver after Beat Saber is handed off', async () => {
      const harness = await createHarness();
      const install = await harness.createInstall();

      const started = await harness.launch.start({
         installId: install.id,
         options: { flags: [], args: [], runAsAdmin: false, closeEncore: true }
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ status: 'completed' });
      expect(harness.events).toEqual(['prepare-watchdog', 'game', 'watchdog']);
      expect(harness.watchdogs).toEqual([
         {
            executablePath: join(harness.dataPath, 'encore-watchdog'),
            args: ['--parent', '123', 'Beat Saber.exe', join(harness.dataPath, 'encore')],
            workingDirectory: harness.dataPath
         }
      ]);
      expect((await harness.launch.getState()).lastLaunch?.options.closeEncore).toBe(true);
   });

   test('does not start Beat Saber when the resource saver is unavailable', async () => {
      const harness = await createHarness();
      const install = await harness.createInstall();
      harness.disableWatchdog();

      const started = await harness.launch.start({
         installId: install.id,
         options: { flags: [], args: [], runAsAdmin: false, closeEncore: true }
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({
         status: 'failed',
         error: { code: 'launch.watchdog.unavailable' }
      });
      expect(harness.spawned).toEqual([]);
      expect(harness.watchdogs).toEqual([]);
   });

   test('runs the Windows build through Proton on Linux', async () => {
      const harness = await createHarness('linux');
      const install = await harness.createInstall();
      const protonPath = await createProtonFolder(harness.dataPath);
      await harness.settingsStore.updateLibrarySettings({ protonPath });

      const started = await harness.launch.start({
         installId: install.id,
         options: { flags: ['proton-logs'], args: [], runAsAdmin: true, closeEncore: false }
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      expect(await waitForOperation(harness.operations, started.value.id)).toMatchObject({ status: 'completed' });
      expect(harness.spawned[0]).toMatchObject({
         executablePath: join(protonPath, 'proton'),
         args: ['run', join(install.path, 'Beat Saber.exe'), '--no-yeet'],
         runAsAdmin: false,
         env: {
            WINEDLLOVERRIDES: 'winhttp=n,b',
            STEAM_COMPAT_DATA_PATH: join(harness.dataPath, 'compatdata'),
            STEAM_COMPAT_INSTALL_PATH: install.path,
            STEAM_COMPAT_CLIENT_INSTALL_PATH: join(harness.dataPath, 'steam'),
            PROTON_LOG: '1',
            PROTON_LOG_DIR: join(install.path, 'Logs')
         }
      });
      expect((await stat(join(harness.dataPath, 'compatdata'))).isDirectory()).toBe(true);
   });

   test('plans host execution for Flatpak and keeps the NixOS runtime wrapper', async () => {
      const harness = await createHarness('linux', { nixOs: true, flatpak: true });
      const install = await harness.createInstall();
      const protonPath = await createProtonFolder(harness.dataPath);
      await harness.settingsStore.updateLibrarySettings({ protonPath });

      const preview = await harness.launch.preview({
         installId: install.id,
         options: { flags: [], args: [], runAsAdmin: false, closeEncore: false }
      });

      expect(preview).toMatchObject({
         status: 'ok',
         proton: {
            protonBinaryPath: join(protonPath, 'proton'),
            steamRunWrapper: true,
            flatpakHost: true
         }
      });
   });

   test('rejects launch options that cannot be passed to a process', async () => {
      const harness = await createHarness();
      const install = await harness.createInstall();

      expect(
         await harness.launch.preview({
            installId: install.id,
            options: { flags: [], args: ['--room\n--fpfc'], runAsAdmin: false, closeEncore: false }
         })
      ).toMatchObject({ status: 'unavailable', issue: 'invalid-options' });
      expect(harness.spawned).toEqual([]);
   });
});

describe('launch arguments', () => {
   test('escapes single quotes when Windows has to elevate the launch', () => {
      expect(quoteForPowerShell("C:\\Games\\Todd's Beat Saber")).toBe("'C:\\Games\\Todd''s Beat Saber'");
   });
});

describe('Proton command', () => {
   const proton = {
      protonBinaryPath: '/home/player/.steam/steam/steamapps/common/Proton 11.0/proton',
      compatDataPath: '/home/player/.config/Encore/compatdata',
      steamClientPath: '/home/player/.steam/steam',
      steamRunWrapper: false,
      flatpakHost: false,
      logPath: null
   };
   const executablePath = '/home/player/Beat Saber/Beat Saber.exe';
   const workingDirectory = '/home/player/Beat Saber';
   const env = { STEAM_COMPAT_DATA_PATH: proton.compatDataPath, SteamAppId: '620980' };

   test('runs Proton directly on a regular Linux host', () => {
      expect(buildProtonCommand({ proton, executablePath, args: ['--no-yeet'], workingDirectory, env })).toEqual({
         executablePath: proton.protonBinaryPath,
         args: ['run', executablePath, '--no-yeet']
      });
   });

   test('runs Proton on the host from a Flatpak install and forwards its launch context', () => {
      expect(buildProtonCommand({ proton: { ...proton, flatpakHost: true }, executablePath, args: [], workingDirectory, env })).toEqual({
         executablePath: 'flatpak-spawn',
         args: [
            '--host',
            `--directory=${workingDirectory}`,
            `--env=STEAM_COMPAT_DATA_PATH=${proton.compatDataPath}`,
            '--env=SteamAppId=620980',
            '--',
            proton.protonBinaryPath,
            'run',
            executablePath
         ]
      });
   });

   test('keeps the NixOS runtime wrapper inside the Flatpak host command', () => {
      const command = buildProtonCommand({
         proton: { ...proton, steamRunWrapper: true, flatpakHost: true },
         executablePath,
         args: [],
         workingDirectory,
         env
      });

      expect(command.args.slice(-5)).toEqual(['--', 'steam-run', proton.protonBinaryPath, 'run', executablePath]);
   });
});

async function createHarness(platform: NodeJS.Platform = 'win32', linuxHost = { nixOs: false, flatpak: false }) {
   const dataPath = await mkdtemp(join(tmpdir(), 'encore-launch-'));
   const installRoot = join(dataPath, 'library');
   await mkdir(installRoot, { recursive: true });

   const settingsStore = createSettingsStore({ dataPath, appVersion: '0.0.0', platform: 'linux', arch: 'x64' });
   await settingsStore.updateLibrarySettings({ installRoot });
   const detectStores = (): Promise<StoreDetectionSnapshot> =>
      Promise.resolve({
         targetId: 'local',
         platform: 'linux',
         scannedAt: new Date().toISOString(),
         stores: [],
         candidates: [],
         diagnostics: []
      });
   const registry = createInstallRegistry({ dataPath, settingsStore, detectStores });
   const operations = createOperationRegistry();
   const spawned: LaunchCommand[] = [];
   const watchdogs: WatchdogCommand[] = [];
   const events: string[] = [];
   let watchdogAvailable = true;
   const watchdogCommand = {
      executablePath: join(dataPath, 'encore-watchdog'),
      args: ['--parent', '123', 'Beat Saber.exe', join(dataPath, 'encore')],
      workingDirectory: dataPath
   };
   const runtime: LaunchRuntime = {
      platform,
      readSteamClient: () => Promise.resolve({ status: 'missing' }),
      readOculusClient: () => Promise.resolve({ status: 'missing' }),
      readLinuxHost: () => Promise.resolve({ steamClientPath: join(dataPath, 'steam'), nixOs: linuxHost.nixOs, flatpak: linuxHost.flatpak }),
      validateProtonFolder,
      prepareProtonCompatData: ensureProtonCompatData,
      startSteamClient: () => Promise.resolve(Result.ok({ pid: 1_212 })),
      startOculusClient: () => Promise.resolve(Result.ok({ pid: 1_213 })),
      spawn: (command) => {
         events.push('game');
         spawned.push(command);
         return Promise.resolve(Result.ok({ pid: 4_242 }));
      },
      prepareWatchdog: () => {
         events.push('prepare-watchdog');
         return Promise.resolve(
            watchdogAvailable
               ? Result.ok(watchdogCommand)
               : Result.err({ code: 'launch.watchdog.unavailable', message: 'the resource saver is unavailable' })
         );
      },
      spawnWatchdog: (command) => {
         events.push('watchdog');
         watchdogs.push(command);
         return Promise.resolve(Result.ok({ pid: 4_243 }));
      }
   };

   cleanups.push(async () => {
      registry.dispose();
      await rm(dataPath, { recursive: true, force: true });
   });

   return {
      dataPath,
      settingsStore,
      operations,
      spawned,
      watchdogs,
      events,
      disableWatchdog: () => {
         watchdogAvailable = false;
      },
      launch: createLaunchService({ settingsStore, registry, operations, runtime, storeClientDelayMs: 0 }),
      createInstall: async () => {
         const path = join(installRoot, 'Beat Saber');
         await mkdir(join(path, 'Beat Saber_Data'), { recursive: true });
         await writeFile(join(path, 'Beat Saber.exe'), 'stub', 'utf8');
         await writeFile(join(path, 'Beat Saber_Data', 'globalgamemanagers'), 'public.app-category.games  1.37.0 ', 'latin1');
         const registered = await registry.register({ source: 'library', path });
         if (Result.isError(registered)) throw new Error('registration failed');

         return registered.value;
      }
   };
}

async function createProtonFolder(parentPath: string) {
   const protonPath = join(parentPath, 'Proton');
   await mkdir(protonPath, { recursive: true });
   await writeFile(join(protonPath, 'proton'), 'stub', 'utf8');
   await chmod(join(protonPath, 'proton'), 0o755);

   return protonPath;
}
