import { Result } from 'better-result';

import { abortableSleep } from '@/lib/async';
import { copyPathWithProgress, deletePathWithProgress } from '@/lib/filesystem/operations';
import { createUniquePath, pathExists, type FilesystemProblem } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import {
   unavailableDownloadPreview,
   type DownloadIssue,
   type DownloadOutcome,
   type DownloadResult,
   type DownloadWarning,
   type SteamDownloadPreview,
   type UnavailableDownloadPreview
} from '@/modules/downloads/contract';
import { beatSaberSteamAppId, beatSaberSteamDepotId, readSteamClientState, type SteamClientState } from '@/modules/downloads/main/steam-client';
import type { VersionCatalog } from '@/modules/downloads/main/version-catalog';
import { readBeatSaberVersion } from '@/modules/installs/main/beat-saber-version';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationError, OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { logRecoveredProblem } from '@/modules/support/main/problem-log';

import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

const depotLayoutFiles = ['Beat Saber.exe', 'UnityPlayer.dll', join('Beat Saber_Data', 'globalgamemanagers')];

const clientIssues: Record<Exclude<SteamClientState['status'], 'ready'>, DownloadIssue> = {
   missing: 'steam-missing',
   'signed-out': 'steam-signed-out',
   'unsupported-platform': 'unsupported-platform'
};

const steamIssueMessages: Partial<Record<DownloadIssue, string>> = {
   'catalog-unavailable': 'the Beat Saber version list is unavailable',
   'depot-not-empty': 'the Steam depot folder still holds content Encore did not download',
   'inspect-failed': 'the download could not be prepared',
   'steam-missing': 'the Steam client is not installed on this machine',
   'steam-signed-out': 'no Steam account is signed in on this machine',
   'unknown-version': 'this Beat Saber version is not in the version list',
   'unsupported-platform': 'Steam downloads need the Windows Steam client'
};

type SteamLaunch = (input: { executablePath: string; manifestId: string }) => Promise<Result<void, string>>;

type SteamDownloaderOptions = {
   settingsStore: SettingsStore;
   registry: InstallRegistry;
   operations: OperationRegistry;
   catalog: VersionCatalog;
   readClientState?: () => Promise<SteamClientState>;
   launch?: SteamLaunch;
   pollIntervalMs?: number;
   settleMs?: number;
   firstBytesTimeoutMs?: number;
   timeoutMs?: number;
};

type DepotSummary = { bytes: number; files: number };

export type SteamDownloader = ReturnType<typeof createSteamDownloader>;

export function createSteamDownloader(options: SteamDownloaderOptions) {
   const readClientState = options.readClientState ?? readSteamClientState;
   const launch = options.launch ?? launchSteamDownload;
   const pollIntervalMs = options.pollIntervalMs ?? 1_000;
   const settleMs = options.settleMs ?? 10_000;
   const firstBytesTimeoutMs = options.firstBytesTimeoutMs ?? 120_000;
   const timeoutMs = options.timeoutMs ?? 3_600_000;

   async function getCatalog() {
      return options.catalog.get();
   }

   async function refreshCatalog() {
      return options.catalog.refresh();
   }

   async function preview(version: string): Promise<SteamDownloadPreview | UnavailableDownloadPreview> {
      const client = await readClientState();
      if (client.status !== 'ready') return unavailable(version, clientIssues[client.status]);

      const catalog = await options.catalog.get();
      if (catalog.status !== 'ready') return unavailable(version, 'catalog-unavailable', catalog.problem?.code);

      const entry = catalog.versions.find((candidate) => candidate.version === version);
      if (!entry) return unavailable(version, 'unknown-version');

      const settings = await options.settingsStore.getSnapshot();
      const installRoot = settings.library.installRoot;
      const desiredPath = join(installRoot, `Beat Saber ${entry.version}`);
      const destination = await createUniquePath(desiredPath);
      if (Result.isError(destination)) return unavailable(version, 'inspect-failed', destination.error.detail);

      const warnings: DownloadWarning[] = ['steam-console-opens'];
      if ((await readDepotEntries(client.depotPath)).length > 0) warnings.push('depot-not-empty');
      if (destination.value !== desiredPath) warnings.push('name-conflict');

      return {
         status: 'ok',
         store: 'steam',
         version: entry.version,
         manifestId: entry.manifestId,
         name: basename(destination.value),
         installRoot,
         destinationPath: destination.value,
         steamPath: client.executablePath,
         depotPath: client.depotPath,
         warnings
      };
   }

   async function start(version: string): Promise<DownloadResult> {
      const previewed = await preview(version);

      if (previewed.status === 'unavailable') {
         return {
            ok: false,
            error: {
               code: `downloads.steam.${previewed.issue}`,
               message: steamIssueMessages[previewed.issue] ?? 'the download could not be prepared',
               details: { version: previewed.version, detail: previewed.detail }
            }
         };
      }

      const controller = new AbortController();
      const operation = options.operations.create({
         kind: 'download',
         title: `Download Beat Saber ${previewed.version}`,
         message: previewed.destinationPath,
         progress: { phase: 'preparing', current: 0, percent: 0, unit: 'bytes' },
         metadata: {
            version: previewed.version,
            destinationPath: previewed.destinationPath,
            depotPath: previewed.depotPath
         },
         cancel: () => controller.abort()
      });

      void runDownload(operation.id, previewed, controller.signal);

      return { ok: true, value: operation };
   }

   async function runDownload(operationId: OperationId, previewed: SteamDownloadPreview, signal: AbortSignal) {
      const preexisting = new Set(await readDepotEntries(previewed.depotPath));
      const initialSize = await getDirectorySize(previewed.depotPath);
      const initial = Result.isOk(initialSize) ? { bytes: initialSize.value.bytes, files: initialSize.value.files } : { bytes: 0, files: 0 };

      const launched = await launch({ executablePath: previewed.steamPath, manifestId: previewed.manifestId });
      if (Result.isError(launched)) {
         return failOperation(operationId, {
            code: 'downloads.steam.launch-failed',
            message: 'the Steam client could not be started',
            details: { detail: launched.error }
         });
      }

      const watched = await watchDepot(operationId, previewed.depotPath, previewed.version, initial, signal);
      if (Result.isError(watched)) return failOperation(operationId, watched.error);

      const prepared = await Result.tryPromise({
         try: () => mkdir(previewed.installRoot, { recursive: true }),
         catch: (cause) => ({
            code: 'downloads.steam.copy-failed',
            message: 'the install root could not be prepared',
            details: { detail: String(cause) }
         })
      });
      if (Result.isError(prepared)) return failOperation(operationId, prepared.error);

      const copied = await copyPathWithProgress({
         sourcePath: previewed.depotPath,
         destinationPath: previewed.destinationPath,
         destinationRoot: previewed.installRoot,
         scope: 'install',
         operationId,
         onProgress: (progress) => options.operations.update(operationId, { progress }),
         signal
      });
      if (Result.isError(copied)) {
         logRecoveredProblem('downloads.steam.copy', copied.error);
         return failOperation(operationId, operationErrorFromProblem(copied.error));
      }

      const registered = await options.registry.register({
         source: 'library',
         path: previewed.destinationPath,
         store: 'steam'
      });
      if (Result.isError(registered)) return failOperation(operationId, operationErrorFromProblem(registered.error));

      await clearDownloadedDepot(operationId, previewed.depotPath, preexisting, signal);

      const outcome: DownloadOutcome = {
         installId: registered.value.id,
         store: 'steam',
         name: registered.value.name,
         path: previewed.destinationPath,
         version: previewed.version,
         bytes: copied.value.bytes,
         files: copied.value.files
      };
      options.operations.complete(operationId, outcome);
   }

   async function watchDepot(operationId: OperationId, depotPath: string, version: string, initial: DepotSummary, signal: AbortSignal) {
      const startedAt = Date.now();
      let previous = initial;
      let changedAt = Date.now();
      let downloadStarted = false;

      while (!signal.aborted) {
         const size = await getDirectorySize(depotPath);
         const summary = Result.isOk(size) ? { bytes: size.value.bytes, files: size.value.files } : { bytes: 0, files: 0 };
         const now = Date.now();

         if (summary.bytes !== previous.bytes || summary.files !== previous.files) {
            previous = summary;
            changedAt = now;
            downloadStarted = true;
            options.operations.update(operationId, {
               progress: { phase: 'downloading', current: summary.bytes, unit: 'bytes', label: `${summary.files} files` }
            });
         }

         if (now - changedAt >= settleMs && (await hasDepotLayout(depotPath)) && (await readBeatSaberVersion(depotPath)) === version) {
            return Result.ok<DepotSummary, OperationError>(summary);
         }
         if (!downloadStarted && now - startedAt >= firstBytesTimeoutMs) {
            return Result.err<DepotSummary, OperationError>({
               code: 'downloads.steam.manifest-unavailable',
               message: 'Steam did not start this download. This build may no longer be available to this Steam account'
            });
         }
         if (now - startedAt >= timeoutMs) {
            return Result.err<DepotSummary, OperationError>({
               code: 'downloads.steam.timed-out',
               message: 'Steam did not finish this download in time'
            });
         }

         await abortableSleep(pollIntervalMs, signal);
      }

      return Result.err<DepotSummary, OperationError>({
         code: 'downloads.steam.cancelled',
         message: 'the download was cancelled'
      });
   }

   async function clearDownloadedDepot(operationId: OperationId, depotPath: string, preexisting: Set<string>, signal: AbortSignal) {
      for (const entry of await readDepotEntries(depotPath)) {
         if (preexisting.has(entry) || signal.aborted) continue;

         await deletePathWithProgress({
            targetPath: join(depotPath, entry),
            root: depotPath,
            scope: 'content',
            allowMissing: true,
            operationId,
            onProgress: (progress) => options.operations.update(operationId, { progress })
         });
      }
   }

   function failOperation(operationId: OperationId, error: OperationError) {
      options.operations.fail(operationId, error);
   }

   function unavailable(version: string | null, issue: DownloadIssue, detail?: string) {
      return unavailableDownloadPreview({ store: 'steam', version, issue, detail });
   }

   return { getCatalog, refreshCatalog, preview, start };
}

async function readDepotEntries(depotPath: string) {
   const entries = await Result.tryPromise({
      try: () => readdir(depotPath),
      catch: () => null
   });

   return Result.isOk(entries) ? entries.value : [];
}

async function hasDepotLayout(depotPath: string) {
   for (const file of depotLayoutFiles) {
      const exists = await pathExists(join(depotPath, file));
      if (Result.isError(exists) || !exists.value) return false;
   }

   return true;
}

function launchSteamDownload(input: { executablePath: string; manifestId: string }) {
   return new Promise<Result<void, string>>((resolve) => {
      const child = spawn(input.executablePath, ['-console', '+download_depot', beatSaberSteamAppId, beatSaberSteamDepotId, input.manifestId], {
         detached: true,
         stdio: 'ignore'
      });

      child.once('spawn', () => {
         child.unref();
         resolve(Result.ok<void, string>(undefined));
      });
      child.once('error', (cause: Error) => {
         resolve(Result.err<void, string>(cause.message));
      });
   });
}

function operationErrorFromProblem(problem: FilesystemProblem): OperationError {
   const context = [problem.detail, problem.path].filter(Boolean).join(' - ');

   return {
      code: problem.code,
      message: context ? `${problem.message}: ${context}` : problem.message,
      details: { path: problem.path, detail: problem.detail }
   };
}
