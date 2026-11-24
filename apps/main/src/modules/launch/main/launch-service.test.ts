import { Result } from 'better-result';
import { expect, test } from 'vite-plus/test';

import { createInstallTestbed, writeInstallFolder } from '@/modules/installs/main/install-registry.fixture';
import { createDefaultLaunchOptions, type LaunchOptions } from '@/modules/launch/contract';
import { elevatedLaunchCommand, type LaunchCommand, type LaunchRuntime } from '@/modules/launch/main/launch-runtime';
import { createLaunchService } from '@/modules/launch/main/launch-service';
import { ensureProtonCompatData, validateProtonFolder } from '@/modules/launch/main/proton';
import { waitForOperation } from '@/modules/operations/main/operation-waiting.fixture';

import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('passes launch options as argv entries and rejects ones that could carry a command', async () => {
   const harness = await createHarness('win32');
   const options = (overrides: Partial<LaunchOptions>): LaunchOptions => ({
      flags: [],
      args: [],
      wrapper: [],
      environment: {},
      runAsAdmin: false,
      closeEncore: false,
      ...overrides
   });

   for (const invalid of [options({ args: ['--room\n--fpfc'] }), options({ environment: { 'x;Start-Process calc;#': '1' }, runAsAdmin: true })]) {
      expect(await harness.launch.preview({ installId: harness.install.id, options: invalid })).toMatchObject({ issue: 'invalid-options' });
   }
   expect(harness.spawned).toEqual([]);

   await harness.start(options({ flags: ['fpfc'], args: ['--room', 'my room; rm -rf ~'], environment: { SOME_ENV_VAR: '1' } }));

   expect(harness.spawned).toMatchObject([
      {
         executablePath: join(harness.install.path, 'Beat Saber.exe'),
         args: ['--no-yeet', 'fpfc', '--room', 'my room; rm -rf ~'],
         env: { SOME_ENV_VAR: '1', SteamAppId: '620980' }
      }
   ]);
});

test('runs the Windows build through Proton on Linux', async () => {
   const harness = await createHarness('linux');
   const protonPath = join(harness.dataPath, 'Proton');
   await mkdir(protonPath);
   await writeFile(join(protonPath, 'proton'), 'stub', 'utf8');
   await chmod(join(protonPath, 'proton'), 0o755);
   await harness.settingsStore.updateLibrarySettings({ protonPath });

   await harness.start({ flags: [], args: [], wrapper: ['mangohud', 'gamemoderun'], environment: {}, runAsAdmin: true, closeEncore: false });

   expect(harness.spawned).toMatchObject([
      {
         executablePath: 'mangohud',
         args: ['gamemoderun', join(protonPath, 'proton'), 'run', join(harness.install.path, 'Beat Saber.exe'), '--no-yeet'],
         runAsAdmin: false,
         env: {
            WINEDLLOVERRIDES: 'winhttp=n,b',
            STEAM_COMPAT_DATA_PATH: join(harness.dataPath, 'compatdata'),
            STEAM_COMPAT_INSTALL_PATH: harness.install.path
         }
      }
   ]);
});

test('blocks launch during a prefix copy without creating compatibility data', async () => {
   const copy = Promise.withResolvers<void>();
   let copying = true;
   const harness = await createHarness('linux', () => (copying ? copy.promise : undefined));
   const protonPath = join(harness.dataPath, 'Proton');
   await mkdir(protonPath);
   await writeFile(join(protonPath, 'proton'), 'stub', { mode: 0o755 });
   await harness.settingsStore.updateLibrarySettings({ protonPath });

   expect(await harness.launch.start({ installId: harness.install.id, options: createDefaultLaunchOptions() })).toMatchObject({
      status: 'error',
      error: { code: 'launch.prefix-copy-in-progress' }
   });
   expect(harness.operations.list()).toEqual([]);
   const compatDataPath = join(harness.dataPath, 'compatdata');
   await expect(stat(compatDataPath)).rejects.toMatchObject({ code: 'ENOENT' });
   expect(harness.spawned).toEqual([]);

   await mkdir(join(compatDataPath, 'pfx'), { recursive: true });
   copying = false;
   copy.resolve();
   await harness.start({ flags: [], args: [], wrapper: [], environment: {}, runAsAdmin: false, closeEncore: false });
   expect(harness.spawned).toHaveLength(1);
});

test('hands elevated launch values to powershell as data rather than script', () => {
   const payload = '’ ; Start-Process calc; #';
   const elevated = elevatedLaunchCommand({
      executablePath: "C:\\Games\\Todd's Beat Saber\\Beat Saber.exe",
      args: ['--room', payload, 'C:\\my dir\\', 'say "hi"'],
      workingDirectory: "C:\\Games\\Todd's Beat Saber",
      env: { SOME_ENV_VAR: payload },
      runAsAdmin: true
   });

   expect(elevated.args.join(' ')).not.toMatch(/calc|Todd/);
   expect(elevated.env).toEqual({
      SOME_ENV_VAR: payload,
      ENCORE_LAUNCH_FILE: "C:\\Games\\Todd's Beat Saber\\Beat Saber.exe",
      ENCORE_LAUNCH_DIRECTORY: "C:\\Games\\Todd's Beat Saber",
      ENCORE_LAUNCH_ARGS: `--room "${payload}" "C:\\my dir\\\\" "say \\"hi\\""`
   });
});

test('stops the close-encore watchdog once an uncancelable operation starts', async () => {
   const harness = await createHarness('linux');
   const protonPath = join(harness.dataPath, 'Proton');
   await mkdir(protonPath);
   await writeFile(join(protonPath, 'proton'), 'stub', 'utf8');
   await chmod(join(protonPath, 'proton'), 0o755);
   await harness.settingsStore.updateLibrarySettings({ protonPath });
   let stopped = false;
   void harness.watchdogExited.then(() => (stopped = true));

   await harness.start({ flags: [], args: [], wrapper: [], environment: {}, runAsAdmin: false, closeEncore: true });
   await Promise.resolve();
   expect(stopped).toBe(false);

   harness.operations.create({ kind: 'patch', title: 'Patching Quest', cancelable: false });
   await harness.watchdogExited;
});

async function createHarness(platform: NodeJS.Platform, waitForPrefixCopy?: () => Promise<void> | undefined) {
   const { dataPath, installRoot, settingsStore, registry, operations, register } = await createInstallTestbed();
   const install = await register(await writeInstallFolder(join(installRoot, 'Beat Saber')));
   const spawned: LaunchCommand[] = [];
   const watchdogExit = Promise.withResolvers<void>();
   const runtime: LaunchRuntime = {
      platform,
      steamFrame: false,
      readSteamClient: () => Promise.resolve({ status: 'missing' }),
      readOculusClient: () => Promise.resolve({ status: 'missing' }),
      readLinuxHost: () =>
         Promise.resolve({ steamClientPath: join(dataPath, 'steam'), nixOs: false, flatpak: false, steamFrame: false, reaperPath: null }),
      validateProtonFolder,
      findProton: () => Promise.resolve(null),
      prepareProtonCompatData: ensureProtonCompatData,
      startSteamClient: () => Promise.resolve(Result.ok({ pid: 1 })),
      startOculusClient: () => Promise.resolve(Result.ok({ pid: 2 })),
      spawn: (command) => {
         spawned.push(command);
         return Promise.resolve(Result.ok({ pid: 3, exited: Promise.withResolvers<void>().promise, stop: () => {} }));
      },
      prepareWatchdog: () => Promise.resolve(Result.ok({ executablePath: 'watchdog', args: [], workingDirectory: dataPath })),
      spawnWatchdog: () => Promise.resolve(Result.ok({ pid: 4, exited: watchdogExit.promise, stop: () => watchdogExit.resolve() }))
   };
   const launch = createLaunchService({ settingsStore, registry, operations, runtime, storeClientDelayMs: 0, waitForPrefixCopy });

   return {
      dataPath,
      settingsStore,
      install,
      launch,
      spawned,
      operations,
      watchdogExited: watchdogExit.promise,
      start: async (options: LaunchOptions) => {
         const started = await launch.start({ installId: install.id, options });
         if (Result.isError(started)) throw new Error('the launch did not start');

         expect(await waitForOperation(operations, started.value.id)).toMatchObject({ status: 'completed' });
      }
   };
}
