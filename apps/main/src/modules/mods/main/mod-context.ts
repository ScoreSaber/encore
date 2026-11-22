import { Result } from 'better-result';

import { createPersistentCache, readRecent, setRecent } from '@/lib/content/content-cache';
import { isSamePath } from '@/lib/filesystem/path';
import type { InstallDetail, InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import { readyModsSnapshotSchema, type ModIssue, type ModPlatform, type ReadyModsSnapshot } from '@/modules/mods/contract';
import type { ModCatalogService } from '@/modules/mods/main/mod-catalog';
import type { ModIndex } from '@/modules/mods/main/mod-index';
import { summarizeMods } from '@/modules/mods/main/mod-plan';
import { scanInstalledMods, type LocalModScan } from '@/modules/mods/main/mod-scan';
import type { AppLogWriter } from '@/modules/support/main/app-log';

const maxCachedScans = 8;

export type ModContext = {
   install: InstallDetail;
   gameVersion: string;
   platform: ModPlatform;
   index: ModIndex;
   scan: LocalModScan;
};

export type ModProblem = {
   issue: ModIssue;
   detail?: string;
};

export function createModContexts(options: { registry: InstallRegistry; catalog: ModCatalogService; dataPath: string; log: AppLogWriter }) {
   const scans = new Map<InstallId, { installPath: string; scan: LocalModScan }>();
   const scanGenerations = new Map<InstallId, number>();
   const snapshotKeys = new Map<InstallId, string>();
   const snapshots = createPersistentCache({
      dataPath: options.dataPath,
      log: options.log,
      name: 'mods',
      valueSchema: readyModsSnapshotSchema,
      maxEntries: 12
   });

   async function load(installId: InstallId, refresh = false): Promise<Result<ModContext, ModProblem>> {
      const generation = (scanGenerations.get(installId) ?? 0) + 1;
      scanGenerations.set(installId, generation);

      const install = await options.registry.get(installId);
      if (!install) return Result.err({ issue: 'not-found' });

      const gameVersion = install.version;
      if (!gameVersion) return Result.err({ issue: 'unknown-version' });

      const platform: ModPlatform = install.store === 'oculus' ? 'oculuspc' : 'steampc';
      const request = { gameVersion, platform };
      const index = refresh ? await options.catalog.refresh(request) : await options.catalog.get(request);
      if (Result.isError(index)) {
         return Result.err({ issue: 'catalog-unavailable', detail: index.error.detail ?? index.error.message });
      }

      const cached = readRecent(scans, install.id);
      if (!refresh && cached && isSamePath(cached.installPath, install.path)) {
         return Result.ok({ install, gameVersion, platform, index: index.value, scan: cached.scan });
      }

      const scan = await scanInstalledMods({ installPath: install.path, index: index.value, lookupHash: options.catalog.lookupHash });
      if (scanGenerations.get(installId) === generation) {
         setRecent(scans, install.id, { installPath: install.path, scan }, maxCachedScans);
      }

      return Result.ok({ install, gameVersion, platform, index: index.value, scan });
   }

   async function cachedSnapshot(installId: InstallId) {
      const install = await options.registry.get(installId);
      if (!install?.version) return null;

      const key = snapshotKey(install.path, install.store === 'oculus' ? 'oculuspc' : 'steampc', install.version);
      snapshotKeys.set(installId, key);
      return snapshots.get(key);
   }

   async function snapshot(installId: InstallId, refresh: boolean): Promise<Result<ReadyModsSnapshot, ModProblem>> {
      const generationBefore = (scanGenerations.get(installId) ?? 0) + 1;
      const context = await load(installId, refresh);
      if (Result.isError(context)) return Result.err(context.error);

      const { install, gameVersion, platform, index, scan } = context.value;
      const next: ReadyModsSnapshot = {
         status: 'ready',
         installId,
         installPath: install.path,
         gameVersion,
         platform,
         source: index.source,
         updatedAt: index.updatedAt,
         sources: index.sources,
         mods: summarizeMods(index, scan),
         external: scan.external,
         bsipaInstalled: scan.bsipaInstalled
      };
      if (scanGenerations.get(installId) === generationBefore) {
         const key = snapshotKey(install.path, platform, gameVersion);
         snapshotKeys.set(installId, key);
         await snapshots.set(key, next);
      }

      return Result.ok(next);
   }

   function forget(installId: InstallId) {
      scanGenerations.set(installId, (scanGenerations.get(installId) ?? 0) + 1);
      scans.delete(installId);
      const key = snapshotKeys.get(installId);
      if (key) {
         snapshotKeys.delete(installId);
         void snapshots.remove(key);
      }
   }

   return { load, cachedSnapshot, snapshot, forget };
}

function snapshotKey(installPath: string, platform: ModPlatform, gameVersion: string) {
   return `${installPath}\0${platform}\0${gameVersion}`;
}
