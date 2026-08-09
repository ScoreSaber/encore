import { Result } from 'better-result';

import type { IpcFailureResult } from '@/ipc/core';
import { abortableSleep } from '@/lib/async';
import { pathExists } from '@/lib/filesystem/path';
import type { InstallDetail } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import {
   beatSaberExecutableName,
   createDefaultLaunchOptions,
   launchOptionsSchema,
   launchFlags,
   launchFlagsFor,
   launchPlatformFor,
   unavailableLaunchPreview,
   type LaunchIssue,
   type LaunchOptions,
   type LaunchOptionsRequest,
   type LaunchOptionsResult,
   type LaunchPreview,
   type LaunchRequestBody,
   type LaunchResult,
   type LaunchState,
   type LaunchWarning,
   type ProtonLaunchPlan,
   type ReadyLaunchPreview
} from '@/modules/launch/contract';
import { buildLaunchArgs, buildLaunchEnv, buildProtonCommand } from '@/modules/launch/main/launch-options';
import { createLaunchRuntime, type LaunchRuntime } from '@/modules/launch/main/launch-runtime';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsSnapshot } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';

import { join } from 'node:path';

const launchIssueMessages: Record<LaunchIssue, string> = {
   'executable-missing': 'the Beat Saber executable is not in the install folder',
   'inspect-failed': 'the install folder could not be inspected',
   'invalid-options': 'the launch options are not something Encore can pass to Beat Saber',
   'not-found': 'the install is not in the registry anymore',
   'proton-not-found': 'the Proton folder in settings does not contain a usable Proton build',
   'proton-not-set': 'no Proton folder is set, so Encore cannot start a Windows build on Linux',
   'store-client-missing': 'the store client this install needs is not installed on that machine',
   'unsupported-platform': 'Encore can only launch Beat Saber on Windows and Linux for now',
   'unsupported-target': 'this target cannot launch installs'
};

type ProtonResolution = { status: 'ok'; plan: ProtonLaunchPlan } | { status: 'unavailable'; issue: LaunchIssue; detail?: string };

type LaunchServiceOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
   operations: OperationRegistry;
   runtime?: LaunchRuntime;
   storeClientDelayMs?: number;
};

export type LaunchService = ReturnType<typeof createLaunchService>;

export function createLaunchService(options: LaunchServiceOptions) {
   const runtime = options.runtime ?? createLaunchRuntime();
   const storeClientDelayMs = options.storeClientDelayMs ?? 5_000;
   const platform = launchPlatformFor(runtime.platform);

   async function getState(): Promise<LaunchState> {
      const settings = await options.settingsStore.getSnapshot();

      return {
         platform,
         supported: platform !== 'other',
         lastLaunch: settings.library.lastLaunch
      };
   }

   async function getOptions({ installId }: LaunchOptionsRequest): Promise<LaunchOptions> {
      const settings = await options.settingsStore.getSnapshot();
      const saved = settings.library.launchOptions[installId];
      const legacy = settings.library.lastLaunch?.installId === installId ? settings.library.lastLaunch.options : null;

      return supportedLaunchOptions(saved ?? legacy ?? createDefaultLaunchOptions());
   }

   async function updateOptions(request: LaunchRequestBody): Promise<LaunchOptionsResult> {
      const launchOptions = supportedLaunchOptions(request.options);
      const written = await options.settingsStore.updateLibrarySettings({ launchOptions: { [request.installId]: launchOptions } });
      if (!written.ok) return written;

      return { ok: true, value: written.value.library.launchOptions[request.installId] ?? launchOptions };
   }

   async function preview(request: LaunchRequestBody): Promise<LaunchPreview> {
      if (platform === 'other') return invalid(request.installId, 'unsupported-platform');

      const parsed = launchOptionsSchema.safeParse(request.options);
      if (!parsed.success) return invalid(request.installId, 'invalid-options');

      const launchOptions = supportedLaunchOptions(parsed.data);
      const install = await options.registry.get(request.installId);
      if (!install) return invalid(request.installId, 'not-found');

      const executablePath = install.executablePath ?? join(install.path, beatSaberExecutableName);
      const exists = await pathExists(executablePath);
      if (Result.isError(exists)) return invalid(request.installId, 'inspect-failed', exists.error.detail);
      if (!exists.value) return invalid(request.installId, 'executable-missing', executablePath);

      const warnings: LaunchWarning[] = [];
      let proton: ProtonLaunchPlan | null = null;

      if (platform === 'linux') {
         const settings = await options.settingsStore.getSnapshot();
         const resolved = await resolveProton(settings, install, launchOptions);
         if (resolved.status === 'unavailable') return invalid(request.installId, resolved.issue, resolved.detail);

         proton = resolved.plan;
         if (proton.logPath) warnings.push('proton-logs');
         if (launchOptions.runAsAdmin) warnings.push('admin-unsupported');
      } else {
         const storeWarning = await checkStoreClient(install, launchOptions);
         if (storeWarning.status === 'unavailable') return invalid(request.installId, storeWarning.issue, storeWarning.detail);

         warnings.push(...storeWarning.warnings);
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
         warnings
      };
   }

   async function checkStoreClient(
      install: InstallDetail,
      launchOptions: LaunchOptions
   ): Promise<{ status: 'ok'; warnings: LaunchWarning[] } | { status: 'unavailable'; issue: LaunchIssue; detail?: string }> {
      if (install.store === 'oculus') {
         const oculus = await runtime.readOculusClient();
         if (oculus.status === 'missing') return { status: 'unavailable', issue: 'store-client-missing', detail: 'oculus' };

         return { status: 'ok', warnings: ['oculus-client-starts'] };
      }

      if (launchOptions.flags.includes('skip-steam')) return { status: 'ok', warnings: ['steam-skipped'] };

      const steam = await runtime.readSteamClient();
      if (steam.status === 'missing' || steam.status === 'unsupported-platform') {
         return install.store === 'steam'
            ? { status: 'unavailable', issue: 'store-client-missing', detail: 'steam' }
            : { status: 'ok', warnings: [] };
      }

      return { status: 'ok', warnings: steam.status === 'signed-out' ? ['steam-client-starts'] : [] };
   }

   async function resolveProton(settings: SettingsSnapshot, install: InstallDetail, launchOptions: LaunchOptions): Promise<ProtonResolution> {
      if (install.store === 'oculus') return { status: 'unavailable', issue: 'store-client-missing', detail: 'oculus' };

      const protonPath = settings.library.protonPath;
      if (!protonPath) return { status: 'unavailable', issue: 'proton-not-set' };

      const validation = await runtime.validateProtonFolder(protonPath);
      if (validation.status === 'invalid') return { status: 'unavailable', issue: 'proton-not-found', detail: validation.path };

      const host = await runtime.readLinuxHost();
      if (!host.steamClientPath) return { status: 'unavailable', issue: 'store-client-missing', detail: 'steam' };

      return {
         status: 'ok',
         plan: {
            protonBinaryPath: validation.protonBinaryPath,
            compatDataPath: join(settings.diagnostics.dataPath, 'compatdata'),
            steamClientPath: host.steamClientPath,
            steamRunWrapper: host.nixOs,
            flatpakHost: host.flatpak,
            logPath: launchOptions.flags.includes('proton-logs') ? join(install.path, 'Logs') : null
         }
      };
   }

   async function start(request: LaunchRequestBody): Promise<LaunchResult> {
      const previewed = await preview(request);
      if (previewed.status === 'unavailable') return failure(previewed.installId, previewed.issue, previewed.detail);

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'launch-preparation',
         title: `Launch ${previewed.name}`,
         message: previewed.executablePath,
         progress: { phase: 'preparing', percent: 0 },
         metadata: { installId: previewed.installId, args: previewed.args },
         cancel: () => controller.abort()
      });

      void runLaunch(operation.id, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runLaunch(operationId: string, previewed: ReadyLaunchPreview, signal: AbortSignal) {
      if (previewed.warnings.includes('steam-client-starts')) {
         options.operations.update(operationId, { message: 'Starting Steam', progress: { phase: 'store-client', percent: 25 } });

         const started = await runtime.startSteamClient();
         if (Result.isError(started)) return options.operations.fail(operationId, started.error);

         await abortableSleep(storeClientDelayMs, signal);
      }

      if (previewed.warnings.includes('oculus-client-starts')) {
         options.operations.update(operationId, { message: 'Starting the Oculus client', progress: { phase: 'store-client', percent: 25 } });

         const started = await runtime.startOculusClient();
         if (Result.isError(started)) return options.operations.fail(operationId, started.error);

         await abortableSleep(storeClientDelayMs, signal);
      }

      if (previewed.proton) {
         options.operations.update(operationId, { message: previewed.proton.compatDataPath, progress: { phase: 'proton-prefix', percent: 50 } });

         const prepared = await runtime.prepareProtonCompatData(previewed.proton.compatDataPath);
         if (Result.isError(prepared)) return options.operations.fail(operationId, prepared.error);
      }

      if (signal.aborted) return;

      options.operations.update(operationId, { message: previewed.executablePath, progress: { phase: 'launching', percent: 75 } });

      const env = buildLaunchEnv({ store: previewed.store, installPath: previewed.workingDirectory, proton: previewed.proton });
      const command = previewed.proton
         ? buildProtonCommand({
              proton: previewed.proton,
              executablePath: previewed.executablePath,
              args: previewed.args,
              workingDirectory: previewed.workingDirectory,
              env
           })
         : { executablePath: previewed.executablePath, args: previewed.args };

      const watchdog = previewed.options.closeEncore ? await runtime.prepareWatchdog() : null;
      if (watchdog && Result.isError(watchdog)) return options.operations.fail(operationId, watchdog.error);

      const spawned = await runtime.spawn({
         ...command,
         workingDirectory: previewed.workingDirectory,
         env,
         // elevation would discard the Proton environment
         runAsAdmin: previewed.options.runAsAdmin && !previewed.proton
      });
      if (Result.isError(spawned)) return options.operations.fail(operationId, spawned.error);

      await options.settingsStore.updateLibrarySettings({
         lastLaunch: { installId: previewed.installId, launchedAt: new Date().toISOString(), options: previewed.options }
      });

      if (watchdog && Result.isOk(watchdog)) {
         const started = await runtime.spawnWatchdog(watchdog.value);
         if (Result.isError(started)) return options.operations.fail(operationId, started.error);
      }

      options.operations.complete(operationId, {
         installId: previewed.installId,
         name: previewed.name,
         executablePath: previewed.executablePath,
         args: previewed.args,
         pid: spawned.value.pid
      });
   }

   function invalid(installId: string, issue: LaunchIssue, detail?: string) {
      return unavailableLaunchPreview({ installId }, issue, detail);
   }

   function failure(installId: string, issue: LaunchIssue, detail?: string): IpcFailureResult {
      return {
         ok: false,
         error: {
            code: `launch.${issue}`,
            message: launchIssueMessages[issue],
            details: { installId, detail }
         }
      };
   }

   function supportedLaunchOptions(launchOptions: LaunchOptions): LaunchOptions {
      const supportedFlags = launchFlagsFor(platform);

      return {
         ...launchOptions,
         flags: launchFlags.filter((flag) => supportedFlags.includes(flag) && launchOptions.flags.includes(flag))
      };
   }

   return { getState, getOptions, updateOptions, preview, start };
}
