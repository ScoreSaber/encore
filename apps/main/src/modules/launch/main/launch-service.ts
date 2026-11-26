import { Result } from 'better-result';

import { abortableSleep } from '@/lib/async';
import { createProblem, type Problem } from '@/lib/errors';
import { pathExists } from '@/lib/filesystem/path';
import { translate } from '@/lib/messages';
import { createLatestGuard } from '@/lib/state/machine';
import type { PrepareArm64 } from '@/modules/arm64/main/arm64-launch';
import type { InstallDetail } from '@/modules/installs/contract';
import { beatSaberExecutablePath, isArm64Image } from '@/modules/installs/main/beat-saber-files';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   createDefaultLaunchOptions,
   launchOptionsSchema,
   launchFlags,
   launchFlagsFor,
   launchPlatformFor,
   unavailableLaunchPreview,
   type LaunchEnvironment,
   type LaunchIssue,
   type LaunchOptions,
   type LaunchOptionsRequest,
   type LaunchPreview,
   type LaunchRequestBody,
   type LaunchState,
   type LaunchWarning,
   type ProtonLaunchPlan,
   type ReadyLaunchPreview
} from '@/modules/launch/contract';
import { buildLaunchArgs, buildLaunchEnv, buildProtonCommand } from '@/modules/launch/main/launch-options';
import type { LaunchRuntime, RunningProcess } from '@/modules/launch/main/launch-runtime';
import type { OperationSnapshot } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsSnapshot } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

import { join } from 'node:path';

type ProtonResolution = { status: 'ok'; plan: ProtonLaunchPlan } | { status: 'unavailable'; issue: LaunchIssue; detail?: string };

type LaunchServiceOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
   operations: OperationRegistry;
   runtime: LaunchRuntime;
   prepareArm64?: PrepareArm64;
   storeClientDelayMs?: number;
};

type GameLifecycle = { status: 'idle' } | { status: 'launching' } | { status: 'running'; process: RunningProcess };

export function createLaunchService(options: LaunchServiceOptions) {
   const runtime = options.runtime;
   const storeClientDelayMs = options.storeClientDelayMs ?? 5_000;
   const platform = launchPlatformFor(runtime.platform);
   const listeners = new Set<(state: LaunchState) => void>();
   const publishGuard = createLatestGuard();
   let lifecycle: GameLifecycle = { status: 'idle' };

   async function getState(): Promise<LaunchState> {
      const settings = await options.settingsStore.getSnapshot();

      return {
         platform,
         supported: platform !== 'other',
         gameRunning: lifecycle.status === 'running',
         steamFrame: runtime.steamFrame,
         lastLaunch: settings.library.lastLaunch
      };
   }

   function subscribe(listener: (state: LaunchState) => void) {
      listeners.add(listener);
      return () => {
         listeners.delete(listener);
      };
   }

   async function publishState() {
      const token = publishGuard.next();
      const state = await getState();
      if (!publishGuard.isCurrent(token)) return;
      for (const listener of listeners) listener(state);
   }

   async function getOptions({ installId }: LaunchOptionsRequest): Promise<LaunchOptions> {
      const settings = await options.settingsStore.getSnapshot();
      return supportedLaunchOptions(settings.library.launchOptions[installId] ?? createDefaultLaunchOptions());
   }

   async function updateOptions(request: LaunchRequestBody) {
      const launchOptions = supportedLaunchOptions(request.options);
      const written = await options.settingsStore.updateLibrarySettings({ launchOptions: { [request.installId]: launchOptions } });
      return written.ok ? Result.ok(written.value.library.launchOptions[request.installId] ?? launchOptions) : Result.err(written.error);
   }

   async function preview(request: LaunchRequestBody): Promise<LaunchPreview> {
      if (platform === 'other') return unavailableLaunchPreview(request, 'unsupported-platform');

      const parsed = launchOptionsSchema.safeParse(request.options);
      if (!parsed.success) return unavailableLaunchPreview(request, 'invalid-options');

      const launchOptions = supportedLaunchOptions(parsed.data);
      const install = await options.registry.get(request.installId);
      if (!install) return unavailableLaunchPreview(request, 'not-found');

      const executablePath = beatSaberExecutablePath(install.path);
      const exists = await pathExists(executablePath);
      if (Result.isError(exists)) return unavailableLaunchPreview(request, 'inspect-failed', exists.error.detail);
      if (!exists.value) return unavailableLaunchPreview(request, 'executable-missing', executablePath);
      if (!options.prepareArm64 && (await isArm64Image(executablePath))) return unavailableLaunchPreview(request, 'arm64-unsupported');

      const warnings: LaunchWarning[] = [];
      let proton: ProtonLaunchPlan | null = null;
      let startClient: 'steam' | 'oculus' | null = null;

      if (platform === 'linux') {
         const settings = await options.settingsStore.getSnapshot();
         const resolved = await resolveProton(settings, install, launchOptions);
         if (resolved.status === 'unavailable') return unavailableLaunchPreview(request, resolved.issue, resolved.detail);

         proton = resolved.plan;
         if (proton.logPath) warnings.push('proton-logs');
         if (launchOptions.runAsAdmin) warnings.push('admin-unsupported');
      } else {
         const storeWarning = await checkStoreClient(install, launchOptions);
         if (storeWarning.status === 'unavailable') return unavailableLaunchPreview(request, storeWarning.issue, storeWarning.detail);

         warnings.push(...storeWarning.warnings);
         startClient = storeWarning.startClient;
         if (launchOptions.runAsAdmin) warnings.push('admin-prompt');
      }

      return {
         status: 'ok',
         installId: install.id,
         name: install.name,
         store: install.store,
         version: install.version,
         executablePath,
         workingDirectory: install.path,
         args: buildLaunchArgs({ flags: launchOptions.flags, args: launchOptions.args, isStoreInstall: install.source === 'store' }),
         options: launchOptions,
         proton,
         startClient,
         warnings
      };
   }

   async function checkStoreClient(
      install: InstallDetail,
      launchOptions: LaunchOptions
   ): Promise<
      | { status: 'ok'; warnings: LaunchWarning[]; startClient: 'steam' | 'oculus' | null }
      | { status: 'unavailable'; issue: LaunchIssue; detail?: string }
   > {
      if (install.store === 'oculus') {
         const oculus = await runtime.readOculusClient();
         if (oculus.status === 'missing') return { status: 'unavailable', issue: 'store-client-missing', detail: 'oculus' };

         return { status: 'ok', warnings: [], startClient: 'oculus' };
      }

      if (launchOptions.flags.includes('skip-steam')) return { status: 'ok', warnings: ['steam-skipped'], startClient: null };

      const steam = await runtime.readSteamClient();
      if (steam.status === 'missing' || steam.status === 'unsupported-platform') {
         return install.store === 'steam'
            ? { status: 'unavailable', issue: 'store-client-missing', detail: 'steam' }
            : { status: 'ok', warnings: [], startClient: null };
      }

      return { status: 'ok', warnings: [], startClient: steam.status === 'signed-out' ? 'steam' : null };
   }

   async function resolveProton(settings: SettingsSnapshot, install: InstallDetail, launchOptions: LaunchOptions): Promise<ProtonResolution> {
      if (install.store === 'oculus') return { status: 'unavailable', issue: 'store-client-missing', detail: 'oculus' };

      const resolved = await protonPlan(settings);
      if (resolved.status === 'unavailable') return resolved;
      return { status: 'ok', plan: { ...resolved.plan, logPath: launchOptions.flags.includes('proton-logs') ? join(install.path, 'Logs') : null } };
   }

   async function protonPlan(settings: SettingsSnapshot): Promise<ProtonResolution> {
      const host = await runtime.readLinuxHost();
      if (!host.steamClientPath) return { status: 'unavailable', issue: 'store-client-missing', detail: 'steam' };

      const protonPath = settings.library.protonPath ?? (await runtime.findProton(host.steamClientPath));
      if (!protonPath) return { status: 'unavailable', issue: 'proton-not-set' };

      const validation = await runtime.validateProtonFolder(protonPath);
      if (validation.status === 'invalid') return { status: 'unavailable', issue: 'proton-not-found', detail: validation.path };

      return {
         status: 'ok',
         plan: {
            protonBinaryPath: validation.protonBinaryPath,
            compatDataPath: join(settings.diagnostics.dataPath, 'compatdata'),
            steamClientPath: host.steamClientPath,
            steamRunWrapper: host.nixOs,
            flatpakHost: host.flatpak,
            steamFrame: host.steamFrame,
            reaperPath: host.steamFrame ? host.reaperPath : null,
            logPath: null
         }
      };
   }

   async function protonFor(): Promise<Result<ProtonLaunchPlan, Problem>> {
      const resolved = await protonPlan(await options.settingsStore.getSnapshot());
      if (resolved.status === 'unavailable') return Result.err(createProblem(`launch.${resolved.issue}`, { detail: resolved.detail }));

      const prepared = await runtime.prepareProtonCompatData(resolved.plan.compatDataPath);
      return prepared.map(() => resolved.plan);
   }

   async function start(request: LaunchRequestBody): Promise<Result<OperationSnapshot, Problem>> {
      const previewed = await preview(request);
      if (previewed.status === 'unavailable') {
         return Result.err(createProblem(`launch.${previewed.issue}`, { installId: previewed.installId, detail: previewed.detail }));
      }

      if (lifecycle.status !== 'idle') {
         return Result.err(createProblem('launch.start-failed', { installId: previewed.installId }));
      }

      lifecycle = { status: 'launching' };
      const operation = options.operations.start(
         {
            kind: 'launch-preparation',
            title: translate('launch.operation', { name: previewed.name }),
            message: previewed.executablePath,
            progress: { phase: 'preparing', percent: 0 },
            metadata: { installId: previewed.installId, args: previewed.args }
         },
         (operationId, signal) =>
            runLaunch(operationId, previewed, signal).finally(() => {
               if (lifecycle.status === 'launching') lifecycle = { status: 'idle' };
            })
      );

      return Result.ok(operation);
   }

   async function runLaunch(operationId: string, previewed: ReadyLaunchPreview, signal: AbortSignal) {
      if (previewed.startClient === 'steam') {
         options.operations.update(operationId, {
            message: translate('launch.progress.startingSteam'),
            progress: { phase: 'store-client', percent: 25 }
         });

         const started = await runtime.startSteamClient();
         if (Result.isError(started)) return options.operations.fail(operationId, started.error);

         await abortableSleep(storeClientDelayMs, signal);
      }

      if (previewed.startClient === 'oculus') {
         options.operations.update(operationId, {
            message: translate('launch.progress.startingOculus'),
            progress: { phase: 'store-client', percent: 25 }
         });

         const started = await runtime.startOculusClient();
         if (Result.isError(started)) return options.operations.fail(operationId, started.error);

         await abortableSleep(storeClientDelayMs, signal);
      }

      if (previewed.proton) {
         options.operations.update(operationId, { message: previewed.proton.compatDataPath, progress: { phase: 'proton-prefix', percent: 50 } });

         const prepared = await runtime.prepareProtonCompatData(previewed.proton.compatDataPath);
         if (Result.isError(prepared)) return options.operations.fail(operationId, prepared.error);
      }

      let native: LaunchEnvironment | null = null;
      if (previewed.proton && options.prepareArm64) {
         options.operations.update(operationId, { message: previewed.workingDirectory, progress: { phase: 'arm64-runtime', percent: 60 } });

         const install = await options.registry.get(previewed.installId);
         const prepared = await options.prepareArm64({
            installPath: previewed.workingDirectory,
            protonBinaryPath: previewed.proton.protonBinaryPath,
            preferNative: install?.source !== 'store' && !previewed.options.flags.includes('emulate-x64'),
            signal,
            onProgress: (progress) => options.operations.update(operationId, { progress })
         });
         if (signal.aborted) return;
         if (Result.isError(prepared)) return options.operations.fail(operationId, prepared.error);
         native = prepared.value;
      }

      if (signal.aborted) return;

      options.operations.update(operationId, { message: previewed.executablePath, progress: { phase: 'launching', percent: 75 } });

      const env = {
         ...buildLaunchEnv({
            store: previewed.store,
            installPath: previewed.workingDirectory,
            proton: previewed.proton,
            native: native !== null,
            environment: previewed.options.environment
         }),
         ...native
      };
      const command = previewed.proton
         ? buildProtonCommand({
              proton: previewed.proton,
              executablePath: previewed.executablePath,
              args: previewed.args,
              wrapper: previewed.options.wrapper,
              workingDirectory: previewed.workingDirectory,
              env
           })
         : { executablePath: previewed.executablePath, args: previewed.args };

      const watchdog = previewed.options.closeEncore ? await runtime.prepareWatchdog() : null;
      if (watchdog && Result.isError(watchdog)) return options.operations.fail(operationId, watchdog.error);
      if (signal.aborted) return;

      const spawned = await runtime.spawn({
         ...command,
         workingDirectory: previewed.workingDirectory,
         env,
         // elevation would discard the Proton environment
         runAsAdmin: previewed.options.runAsAdmin && !previewed.proton
      });
      if (Result.isError(spawned)) return options.operations.fail(operationId, spawned.error);

      const game = spawned.value;
      lifecycle = { status: 'running', process: game };
      void game.exited.then(() => {
         if (lifecycle.status !== 'running' || lifecycle.process !== game) return;

         lifecycle = { status: 'idle' };
         void publishState();
      });

      await options.settingsStore.updateLibrarySettings({
         lastLaunch: { installId: previewed.installId, launchedAt: new Date().toISOString(), options: previewed.options }
      });
      await publishState();

      if (watchdog && Result.isOk(watchdog) && !signal.aborted) {
         const started = await runtime.spawnWatchdog(watchdog.value);
         if (Result.isError(started)) return options.operations.fail(operationId, started.error);
         guardWatchdog(started.value);
      }

      options.operations.complete(operationId, {
         installId: previewed.installId,
         name: previewed.name,
         executablePath: previewed.executablePath,
         args: previewed.args,
         pid: spawned.value.pid
      });
   }

   function guardWatchdog(watchdog: RunningProcess) {
      const stopIfBlocked = () => {
         if (options.operations.uncancelable().length > 0) watchdog.stop();
      };
      const unsubscribe = options.operations.subscribeTargets(stopIfBlocked);
      void watchdog.exited.then(unsubscribe);
      stopIfBlocked();
   }

   function supportedLaunchOptions(launchOptions: LaunchOptions): LaunchOptions {
      const supportedFlags = launchFlagsFor(platform, runtime.steamFrame);

      return {
         ...launchOptions,
         flags: launchFlags.filter((flag) => supportedFlags.includes(flag) && launchOptions.flags.includes(flag)),
         wrapper: platform === 'linux' ? launchOptions.wrapper : []
      };
   }

   return { getState, getOptions, updateOptions, preview, start, subscribe, protonFor };
}
