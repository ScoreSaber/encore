import { Result } from 'better-result';

import { abortableSleep } from '@/lib/async';
import { createProblem, type Problem } from '@/lib/errors';
import { copyPathWithProgress, deletePathWithProgress } from '@/lib/filesystem/operations';
import { removeQuietly } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import { translate } from '@/lib/messages';
import { createSerialQueue } from '@/lib/state/machine';
import type { DownloadIssue, DownloadVersion, DownloadWarning, SteamDownloadPreview } from '@/modules/downloads/contract';
import { isSteamDepotComplete, readSteamManifest } from '@/modules/downloads/main/steam-manifest';
import type { OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import { beatSaberSteamAppId, beatSaberSteamDepotId, readSteamClientState, type SteamClientState } from '@/modules/stores/main/steam-client';

import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type SteamLaunch = (input: { executablePath: string; manifestId: string }) => Promise<Result<void, string>>;

type SteamDownloaderOptions = {
   operations: OperationRegistry;
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
   const depotQueue = createSerialQueue();

   async function preview(
      entry: DownloadVersion,
      destination: Pick<SteamDownloadPreview, 'name' | 'installRoot' | 'destinationPath' | 'warnings'>
   ): Promise<Result<SteamDownloadPreview, { issue: DownloadIssue }>> {
      const client = await readClientState();
      if (client.status === 'missing') return Result.err({ issue: 'steam-missing' });
      if (client.status === 'signed-out') return Result.err({ issue: 'steam-signed-out' });
      if (client.status === 'unsupported-platform') return Result.err({ issue: 'unsupported-platform' });

      const warnings: DownloadWarning[] = process.platform === 'win32' ? ['steam-console-opens'] : [];
      if ((await readDepotEntries(client.depotPath)).length > 0) warnings.push('depot-not-empty');

      return Result.ok({
         status: 'ok',
         store: 'steam',
         version: entry.version,
         manifestId: entry.manifestId,
         ...destination,
         steamPath: client.executablePath,
         depotPath: client.depotPath,
         warnings: [...warnings, ...destination.warnings]
      });
   }

   function download(previewed: SteamDownloadPreview, operationId: OperationId, signal: AbortSignal): Promise<Result<DepotSummary, Problem>> {
      return depotQueue.run(async () => {
         if (signal.aborted) return Result.err(createProblem('downloads.steam.cancelled'));

         const preexisting = new Set(await readDepotEntries(previewed.depotPath));
         const initial = await readDepotSummary(previewed.depotPath);

         const launched = await launch({ executablePath: previewed.steamPath, manifestId: previewed.manifestId });
         if (Result.isError(launched)) return Result.err(createProblem('downloads.steam.launch-failed', { cause: launched.error }));

         const watched = await watchDepot(operationId, previewed.depotPath, previewed.manifestId, initial, signal);
         if (Result.isError(watched)) return Result.err(watched.error);

         const prepared = await Result.tryPromise({
            try: () => mkdir(previewed.installRoot, { recursive: true }),
            catch: (cause) => createProblem('downloads.steam.prepare-failed', { path: previewed.installRoot, cause })
         });
         if (Result.isError(prepared)) return Result.err(prepared.error);

         const copied = await copyPathWithProgress({
            sourcePath: previewed.depotPath,
            destinationPath: previewed.destinationPath,
            destinationRoot: previewed.installRoot,
            onProgress: (progress) => options.operations.update(operationId, { progress }),
            signal
         });
         if (Result.isError(copied)) {
            await removeQuietly(previewed.destinationPath);
            return Result.err(copied.error);
         }

         await clearDownloadedDepot(operationId, previewed.depotPath, preexisting, signal);

         return Result.ok({ bytes: copied.value.bytes, files: copied.value.files });
      });
   }

   async function watchDepot(operationId: OperationId, depotPath: string, manifestId: string, initial: DepotSummary, signal: AbortSignal) {
      const startedAt = Date.now();
      let previous = initial;
      let changedAt = Date.now();
      let watchPhase: 'waiting-for-start' | 'downloading' = 'waiting-for-start';
      let lastReportedRate: number | undefined;
      let manifest: Awaited<ReturnType<typeof readSteamManifest>> = null;
      const recent: { at: number; bytes: number }[] = [];

      while (!signal.aborted) {
         const summary = await readDepotSummary(depotPath);
         const now = Date.now();
         recent.push({ at: now, bytes: summary.bytes });
         if (recent.length > rateWindow) recent.shift();
         const rate = bytesPerSecond(recent);

         if (summary.bytes !== previous.bytes || summary.files !== previous.files) {
            previous = summary;
            changedAt = now;
            watchPhase = 'downloading';
            lastReportedRate = rate;
            options.operations.update(operationId, {
               progress: {
                  phase: 'downloading',
                  current: summary.bytes,
                  perSecond: rate,
                  unit: 'bytes',
                  label: translate('common.operation.files', { count: summary.files })
               }
            });
         } else if (watchPhase === 'downloading' && rate === 0 && lastReportedRate !== 0) {
            lastReportedRate = 0;
            options.operations.update(operationId, {
               progress: {
                  phase: 'downloading',
                  current: summary.bytes,
                  perSecond: 0,
                  unit: 'bytes',
                  label: translate('common.operation.files', { count: summary.files })
               }
            });
         }

         if (now - changedAt >= settleMs) {
            manifest ??= await readDepotManifest(depotPath, manifestId);
            if (manifest && (await isSteamDepotComplete(depotPath, manifest))) return Result.ok<DepotSummary, Problem>(summary);
            if (!manifest && watchPhase === 'downloading') return Result.err<DepotSummary, Problem>(createProblem('downloads.steam.unverified'));
            changedAt = Date.now();
         }
         if (watchPhase === 'waiting-for-start' && now - startedAt >= firstBytesTimeoutMs) {
            return Result.err<DepotSummary, Problem>(createProblem('downloads.steam.manifest-unavailable'));
         }
         if (now - startedAt >= timeoutMs) {
            return Result.err<DepotSummary, Problem>(createProblem('downloads.steam.timed-out'));
         }

         await abortableSleep(pollIntervalMs, signal);
      }

      return Result.err<DepotSummary, Problem>(createProblem('downloads.steam.cancelled'));
   }

   async function clearDownloadedDepot(operationId: OperationId, depotPath: string, preexisting: Set<string>, signal: AbortSignal) {
      for (const entry of await readDepotEntries(depotPath)) {
         if (preexisting.has(entry) || signal.aborted) continue;

         await deletePathWithProgress({
            targetPath: join(depotPath, entry),
            root: depotPath,
            allowMissing: true,
            onProgress: (progress) => options.operations.update(operationId, { progress })
         });
      }
   }

   return { preview, download };
}

const rateWindow = 5;

function bytesPerSecond(recent: { at: number; bytes: number }[]) {
   const first = recent[0];
   const last = recent.at(-1);
   if (!first || !last || last.at <= first.at) return undefined;
   return Math.max(0, ((last.bytes - first.bytes) * 1000) / (last.at - first.at));
}

async function readDepotManifest(depotPath: string, manifestId: string) {
   const steamappsParent = resolve(depotPath, '..', '..', '..', '..');
   const name = `${beatSaberSteamDepotId}_${manifestId}.manifest`;
   return (
      (await readSteamManifest(join(steamappsParent, 'depotcache', name))) ??
      (await readSteamManifest(join(dirname(steamappsParent), 'depotcache', name)))
   );
}

async function readDepotSummary(depotPath: string): Promise<DepotSummary> {
   const size = await getDirectorySize(depotPath);
   return Result.isOk(size) ? { bytes: size.value.bytes, files: size.value.files } : { bytes: 0, files: 0 };
}

async function readDepotEntries(depotPath: string) {
   const entries = await Result.tryPromise({
      try: () => readdir(depotPath),
      catch: () => null
   });

   return Result.isOk(entries) ? entries.value : [];
}

function launchSteamDownload(input: { executablePath: string; manifestId: string }) {
   return new Promise<Result<void, string>>((resolve) => {
      const consoleFlag = process.platform === 'win32' ? ['-console'] : [];
      const child = spawn(input.executablePath, [...consoleFlag, '+download_depot', beatSaberSteamAppId, beatSaberSteamDepotId, input.manifestId], {
         detached: true,
         stdio: 'ignore'
      });

      child.once('spawn', () => {
         child.unref();
         resolve(Result.ok<void, string>(undefined));
      });
      child.once('error', (cause) => {
         resolve(Result.err<void, string>(cause.message));
      });
   });
}
