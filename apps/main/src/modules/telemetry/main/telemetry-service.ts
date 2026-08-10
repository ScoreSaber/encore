import { Result } from 'better-result';
import { z } from 'zod';

import { readJsonFile, writeJsonFileAtomic } from '@/lib/filesystem/json';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { localTargetId } from '@/modules/targets/contract';
import { readTelemetryHostDetails } from '@/modules/telemetry/main/host-details';

import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { join } from 'node:path';

const reportIntervalMs = 7 * 24 * 60 * 60 * 1_000;
const refreshCheckIntervalMs = 24 * 60 * 60 * 1_000;
const changeDebounceMs = 5_000;

const storedTelemetryStateSchema = z.object({
   schemaVersion: z.literal(1),
   anonymousId: z.uuid(),
   lastReportedAt: z.iso.datetime().nullable(),
   lastSnapshotFingerprint: z.string().nullable(),
   lastRefreshCheckedAt: z.iso.datetime().nullable(),
   refreshGeneration: z.string().nullable()
});

type StoredTelemetryState = z.infer<typeof storedTelemetryStateSchema>;

type TelemetryReportProperties = {
   app_version: string;
   operating_system: string;
   linux_distribution: string | null;
   proton_version: string | null;
   report_reason: 'remote-refresh' | 'changed' | 'scheduled';
   snapshot_id: string;
};

type TelemetryCapture = {
   distinctId: string;
} & (
   | {
        event: 'encore.census.reported';
        properties: TelemetryReportProperties & {
           beat_saber_install_count: number;
           active_beat_saber_version: string | null;
           custom_repository_count: number;
        };
     }
   | {
        event: 'encore.repository.reported';
        properties: TelemetryReportProperties & {
           repository_url: string;
           enabled: boolean;
        };
     }
);

export type TelemetryClient = {
   capture: (event: TelemetryCapture) => void;
   getRefreshGeneration: (distinctId: string) => Promise<string | null>;
   shutdown: () => Promise<void>;
};

type TelemetryServiceOptions = {
   dataPath: string;
   appVersion: string;
   operatingSystem: string;
   settings: Pick<SettingsStore, 'getSnapshot' | 'subscribe'>;
   installs: Pick<InstallRegistry, 'list' | 'subscribe'>;
   client: TelemetryClient;
   platform: NodeJS.Platform;
   now?: () => Date;
};

export function createTelemetryService(options: TelemetryServiceOptions) {
   const statePath = join(options.dataPath, 'telemetry.json');
   let state: StoredTelemetryState | null = null;
   let disposed = false;
   let changeTimer: ReturnType<typeof setTimeout> | null = null;
   let pollTimer: ReturnType<typeof setInterval> | null = null;
   let reportQueue = Promise.resolve();

   const unsubscribeSettings = options.settings.subscribe((snapshot) => {
      if (!snapshot.app.telemetryEnabled) return;
      scheduleReport();
   });
   const unsubscribeInstalls = options.installs.subscribe(scheduleReport);

   function scheduleReport() {
      if (disposed) return;
      if (changeTimer) clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
         changeTimer = null;
         void report();
      }, changeDebounceMs);
      changeTimer.unref();
   }

   function report() {
      reportQueue = reportQueue.then(runReport);
      return reportQueue;
   }

   async function runReport() {
      if (disposed) return;

      const gathered = await Result.tryPromise({
         try: () => Promise.all([options.settings.getSnapshot(), options.installs.list()]),
         catch: () => undefined
      });
      if (Result.isError(gathered)) return;

      const [settings, installs] = gathered.value;
      if (!settings.app.telemetryEnabled) return;

      const hostDetails = await readTelemetryHostDetails(options.platform, settings.library.protonPath);

      const currentState = await loadState();
      const currentTime = options.now?.() ?? new Date();
      let refreshGeneration = currentState.refreshGeneration;
      let lastRefreshCheckedAt = currentState.lastRefreshCheckedAt;

      if (!currentState.lastRefreshCheckedAt || currentTime.getTime() - Date.parse(currentState.lastRefreshCheckedAt) >= refreshCheckIntervalMs) {
         const refreshed = await Result.tryPromise({
            try: () => options.client.getRefreshGeneration(currentState.anonymousId),
            catch: () => undefined
         });
         if (Result.isOk(refreshed) && refreshed.value !== null) refreshGeneration = refreshed.value;
         lastRefreshCheckedAt = currentTime.toISOString();
      }

      const snapshot = createTelemetrySnapshot({
         appVersion: options.appVersion,
         operatingSystem: options.operatingSystem,
         ...hostDetails,
         settings,
         installs
      });
      const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
      const forced = refreshGeneration !== null && refreshGeneration !== currentState.refreshGeneration;
      const changed = fingerprint !== currentState.lastSnapshotFingerprint;
      const scheduled = !currentState.lastReportedAt || currentTime.getTime() - Date.parse(currentState.lastReportedAt) >= reportIntervalMs;

      if (!forced && !changed && !scheduled) {
         await saveState({
            ...currentState,
            lastRefreshCheckedAt,
            refreshGeneration
         });
         return;
      }

      const commonProperties: TelemetryReportProperties = {
         app_version: snapshot.appVersion,
         operating_system: snapshot.operatingSystem,
         linux_distribution: snapshot.linuxDistribution,
         proton_version: snapshot.protonVersion,
         report_reason: forced ? 'remote-refresh' : changed ? 'changed' : 'scheduled',
         snapshot_id: randomUUID()
      };

      options.client.capture({
         distinctId: currentState.anonymousId,
         event: 'encore.census.reported',
         properties: {
            ...commonProperties,
            beat_saber_install_count: snapshot.beatSaberInstallCount,
            active_beat_saber_version: snapshot.activeBeatSaberVersion,
            custom_repository_count: snapshot.repositories.length
         }
      });
      for (const repository of snapshot.repositories) {
         options.client.capture({
            distinctId: currentState.anonymousId,
            event: 'encore.repository.reported',
            properties: {
               ...commonProperties,
               repository_url: repository.url,
               enabled: repository.enabled
            }
         });
      }

      await saveState({
         ...currentState,
         lastReportedAt: currentTime.toISOString(),
         lastSnapshotFingerprint: fingerprint,
         lastRefreshCheckedAt,
         refreshGeneration
      });
   }

   async function loadState() {
      if (state) return state;

      const loaded = await readJsonFile(statePath, storedTelemetryStateSchema);
      state = Result.isOk(loaded)
         ? loaded.value
         : {
              schemaVersion: 1,
              anonymousId: randomUUID(),
              lastReportedAt: null,
              lastSnapshotFingerprint: null,
              lastRefreshCheckedAt: null,
              refreshGeneration: null
           };
      return state;
   }

   async function saveState(next: StoredTelemetryState) {
      const written = await writeJsonFileAtomic(statePath, next, storedTelemetryStateSchema, {
         root: options.dataPath,
         scope: 'settings'
      });
      if (Result.isOk(written)) state = written.value;
   }

   async function start() {
      await report();
      if (disposed) return;

      pollTimer = setInterval(() => void report(), refreshCheckIntervalMs);
      pollTimer.unref();
   }

   async function dispose() {
      disposed = true;
      unsubscribeSettings();
      unsubscribeInstalls();
      if (changeTimer) clearTimeout(changeTimer);
      if (pollTimer) clearInterval(pollTimer);
      await reportQueue;
      await options.client.shutdown();
   }

   return { start, report, dispose };
}

export function createTelemetrySnapshot(input: {
   appVersion: string;
   operatingSystem: string;
   linuxDistribution: string | null;
   protonVersion: string | null;
   settings: Awaited<ReturnType<SettingsStore['getSnapshot']>>;
   installs: Awaited<ReturnType<InstallRegistry['list']>>;
}) {
   const repositories = input.settings.app.modRepositories
      .flatMap((repository) => {
         const url = normalizeTelemetryRepositoryUrl(repository.listingUrl);
         return url ? [{ url, enabled: repository.enabled }] : [];
      })
      .sort((left, right) => left.url.localeCompare(right.url) || Number(left.enabled) - Number(right.enabled));

   return {
      appVersion: input.appVersion,
      operatingSystem: input.operatingSystem,
      linuxDistribution: input.linuxDistribution,
      protonVersion: input.protonVersion,
      beatSaberInstallCount: input.installs.installs.length,
      activeBeatSaberVersion:
         input.installs.installs.find((install) => install.id === input.settings.app.selection.installIds[localTargetId])?.version ?? null,
      repositories
   };
}

export function describeOperatingSystem(platform: NodeJS.Platform, systemVersion: string) {
   const parts = systemVersion.split('.').map((part) => Number.parseInt(part, 10));
   const major = parts[0];

   if (platform === 'win32') {
      const build = parts[2];
      if (major === 10 && build !== undefined) return build >= 22_000 ? 'Windows 11' : 'Windows 10';
      if (major === 6 && parts[1] === 3) return 'Windows 8.1';
      if (major === 6 && parts[1] === 2) return 'Windows 8';
      if (major === 6 && parts[1] === 1) return 'Windows 7';
      return 'Windows';
   }

   if (platform === 'darwin') return major === undefined || Number.isNaN(major) ? 'macOS' : `macOS ${major}.x`;
   if (platform === 'linux') return major === undefined || Number.isNaN(major) ? 'Linux' : `Linux ${major}.x`;

   return platform;
}

export function normalizeTelemetryRepositoryUrl(input: string) {
   const parsed = Result.try({
      try: () => new URL(input),
      catch: () => undefined
   });
   if (Result.isError(parsed)) return null;

   const url = parsed.value;
   const hostname = url.hostname.toLowerCase();
   if (url.protocol !== 'https:' || url.username || url.password) return null;
   if (
      isIP(hostname) !== 0 ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      !hostname.includes('.')
   ) {
      return null;
   }

   url.hostname = hostname;
   url.hash = '';
   url.search = '';
   return url.toString();
}
