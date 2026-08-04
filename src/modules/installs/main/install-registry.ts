import { Result } from 'better-result';

import { isSamePath, resolveFilesystemPath, readPathInfo, type FilesystemProblem } from '@/lib/filesystem/path';
import {
   installSummarySchema,
   type InstallDetail,
   type InstallId,
   type InstallProblem,
   type InstallRegistrySnapshot
} from '@/modules/installs/contract';
import { readBeatSaberVersion } from '@/modules/installs/main/beat-saber-version';
import { createInstallStore, type InstallRecord, type InstallRegistration } from '@/modules/installs/main/install-store';
import { stripMechanicalSuffix } from '@/modules/installs/main/naming';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreInstallCandidate } from '@/modules/stores/contract';
import { localTargetId } from '@/modules/targets/contract';

import { basename } from 'node:path';

type InstallRegistryOptions = {
   dataPath: string;
   settingsStore: SettingsStore;
   detectStores: () => Promise<{ candidates: StoreInstallCandidate[] }>;
};

export type InstallRegistry = ReturnType<typeof createInstallRegistry>;

export function createInstallRegistry(options: InstallRegistryOptions) {
   const store = createInstallStore({ dataPath: options.dataPath });
   const listeners = new Set<(snapshot: InstallRegistrySnapshot) => void>();

   let snapshot: InstallRegistrySnapshot | null = null;
   let details = new Map<InstallId, InstallDetail>();
   let pendingScan: Promise<InstallRegistrySnapshot> | null = null;

   const unsubscribeSettings = options.settingsStore.subscribe((settings) => {
      if (!snapshot || isSamePath(settings.library.installRoot, snapshot.installRoot)) return;

      void rescan();
   });

   async function list() {
      return snapshot ?? scan();
   }

   async function get(installId: InstallId) {
      await list();
      return details.get(installId) ?? null;
   }

   async function rescan() {
      snapshot = null;
      return scan();
   }

   async function register(registration: Omit<InstallRegistration, 'targetId'>) {
      const registered = await store.register({ ...registration, targetId: localTargetId });
      if (Result.isError(registered)) return Result.err<InstallDetail, FilesystemProblem>(registered.error);

      await rescan();
      const detail = details.get(registered.value.id);

      return detail
         ? Result.ok<InstallDetail, FilesystemProblem>(detail)
         : Result.err<InstallDetail, FilesystemProblem>({
              code: 'filesystem.path.not-found',
              message: 'the registered install could not be read back',
              path: registered.value.path
           });
   }

   async function update(installId: InstallId, patch: { name?: string; color?: string | null }) {
      const updated = await store.update(installId, patch);
      if (Result.isError(updated)) return Result.err<InstallDetail | null, FilesystemProblem>(updated.error);
      if (!updated.value) return Result.ok<InstallDetail | null, FilesystemProblem>(null);

      await rescan();
      return Result.ok<InstallDetail | null, FilesystemProblem>(details.get(installId) ?? null);
   }

   async function associateStore(installId: InstallId, detectedStore: InstallDetail['store']) {
      if (!detectedStore) return Result.ok<InstallDetail | null, FilesystemProblem>(await get(installId));

      const updated = await store.update(installId, { store: detectedStore });
      if (Result.isError(updated)) return Result.err<InstallDetail | null, FilesystemProblem>(updated.error);
      if (!updated.value) return Result.ok<InstallDetail | null, FilesystemProblem>(null);

      await rescan();
      return Result.ok<InstallDetail | null, FilesystemProblem>(details.get(installId) ?? null);
   }

   async function forget(installId: InstallId) {
      const removed = await store.remove(installId);
      if (Result.isError(removed)) return removed;

      await rescan();
      return removed;
   }

   function subscribe(listener: (snapshot: InstallRegistrySnapshot) => void) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   function dispose() {
      unsubscribeSettings();
      listeners.clear();
   }

   async function scan() {
      pendingScan ??= runScan();

      try {
         return await pendingScan;
      } finally {
         pendingScan = null;
      }
   }

   async function runScan(): Promise<InstallRegistrySnapshot> {
      const settings = await options.settingsStore.getSnapshot();
      const installRoot = resolveFilesystemPath(settings.library.installRoot);
      const problems: InstallProblem[] = [];

      const detection = await options.detectStores();
      const resolved = await store.resolveStoreCandidates(detection.candidates);
      if (Result.isError(resolved)) {
         problems.push({
            code: 'install.registry.write-failed',
            message: 'the install registry could not be saved',
            path: store.filePath,
            ...(resolved.error.detail ? { detail: resolved.error.detail } : {})
         });
      }

      const records = Result.isOk(resolved) ? resolved.value : await store.load();
      const scanned = await Promise.all(records.map((record) => describeInstall(record, problems)));

      details = new Map(scanned.map((detail) => [detail.id, detail]));
      snapshot = {
         installRoot,
         scannedAt: new Date().toISOString(),
         installs: scanned.map((detail) => installSummarySchema.parse(detail)),
         problems
      };

      emit(snapshot);
      return snapshot;
   }

   async function describeInstall(record: InstallRecord, problems: InstallProblem[]): Promise<InstallDetail> {
      const info = await readPathInfo(record.path);
      const missing = Result.isError(info) || info.value.kind !== 'directory';
      const version = missing ? null : await readBeatSaberVersion(record.path);
      const problem: InstallProblem | undefined = missing
         ? {
              code: 'install.path.unreadable',
              message: 'the install folder could not be read',
              installId: record.id,
              path: record.path,
              ...(Result.isError(info) && info.error.detail ? { detail: info.error.detail } : {})
           }
         : version
           ? undefined
           : {
                code: 'install.version.unknown',
                message: 'Beat Saber version could not be detected',
                installId: record.id,
                path: record.path
             };

      if (problem) problems.push(problem);

      return {
         id: record.id,
         name:
            record.name === `Beat Saber ${version}`
               ? (version ?? record.name)
               : (record.name ?? version ?? stripMechanicalSuffix(basename(record.path))),
         version,
         store: record.store,
         source: record.source,
         path: record.path,
         color: record.color,
         status: missing ? 'missing' : version ? 'ready' : 'incomplete',
         createdAt: record.createdAt,
         updatedAt: record.updatedAt,
         aliases: record.aliases,
         ...(record.libraryPath ? { libraryPath: record.libraryPath } : {}),
         ...(record.appId ? { appId: record.appId } : {}),
         ...(record.manifestPath ? { manifestPath: record.manifestPath } : {}),
         ...(record.executablePath ? { executablePath: record.executablePath } : {}),
         ...(problem ? { problem } : {})
      };
   }

   function emit(next: InstallRegistrySnapshot) {
      for (const listener of listeners) {
         listener(next);
      }
   }

   return {
      list,
      get,
      rescan,
      register,
      update,
      associateStore,
      forget,
      subscribe,
      dispose
   };
}
