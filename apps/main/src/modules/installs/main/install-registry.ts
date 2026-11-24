import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { isSamePath, resolveFilesystemPath, readPathInfo, type FilesystemProblem } from '@/lib/filesystem/path';
import { createSerialQueue } from '@/lib/state/machine';
import {
   installSummarySchema,
   type InstallDetail,
   type InstallId,
   type InstallProblem,
   type InstallRegistrySnapshot
} from '@/modules/installs/contract';
import { readBeatSaberVersion } from '@/modules/installs/main/beat-saber-files';
import { createInstallStore, type InstallRecord, type InstallRecordPatch, type InstallRegistration } from '@/modules/installs/main/install-store';
import { stripMechanicalSuffix } from '@/modules/installs/main/naming';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import type { StoreInstallCandidate, StoreKind } from '@/modules/stores/contract';

import { basename } from 'node:path';

type InstallRegistryOptions = {
   dataPath: string;
   settingsStore: SettingsStore;
   detectStores: () => Promise<StoreInstallCandidate[]>;
};

type RegistryState =
   | { status: 'uninitialized' }
   | { status: 'scanning'; scan: number; pending: Promise<InstallRegistrySnapshot>; lastInstallRoot: string | null }
   | { status: 'ready'; scan: number; snapshot: InstallRegistrySnapshot; details: Map<InstallId, InstallDetail> }
   | { status: 'disposed' };

export type InstallRegistry = ReturnType<typeof createInstallRegistry>;

export function createInstallRegistry(options: InstallRegistryOptions) {
   const store = createInstallStore({ dataPath: options.dataPath });
   const listeners = new Set<(snapshot: InstallRegistrySnapshot) => void>();
   const mutations = createSerialQueue();

   let state: RegistryState = { status: 'uninitialized' };
   let scans = 0;

   const unsubscribeSettings = options.settingsStore.subscribe((settings) => {
      if (state.status === 'disposed' || state.status === 'uninitialized') return;

      const knownRoot = state.status === 'ready' ? state.snapshot.installRoot : state.lastInstallRoot;
      if (knownRoot !== null && isSamePath(settings.library.installRoot, knownRoot)) return;

      void rescan();
   });

   async function list() {
      if (state.status === 'ready') return state.snapshot;
      if (state.status === 'scanning') return state.pending;
      return rescan();
   }

   async function get(installId: InstallId) {
      if (state.status === 'uninitialized') await rescan();
      while (state.status === 'scanning') await state.pending;

      return state.status === 'ready' ? (state.details.get(installId) ?? null) : null;
   }

   function rescan(): Promise<InstallRegistrySnapshot> {
      if (state.status === 'disposed') return runScan().then((scanned) => scanned.snapshot);

      const scan = ++scans;
      const lastInstallRoot = state.status === 'ready' ? state.snapshot.installRoot : state.status === 'scanning' ? state.lastInstallRoot : null;
      const pending = runScan().then((scanned) => {
         if (state.status === 'disposed') return scanned.snapshot;
         if (scan !== scans) return list();

         state = { status: 'ready', scan, snapshot: scanned.snapshot, details: scanned.details };
         emit(scanned.snapshot);
         return scanned.snapshot;
      });
      state = { status: 'scanning', scan, pending, lastInstallRoot };
      return pending;
   }

   function register(registration: InstallRegistration) {
      return mutations.run(async () => {
         const registered = await store.register(registration);
         if (Result.isError(registered)) return Result.err<InstallDetail, FilesystemProblem>(registered.error);

         await rescan();
         const detail = state.status === 'ready' ? state.details.get(registered.value.id) : undefined;

         return detail
            ? Result.ok<InstallDetail, FilesystemProblem>(detail)
            : Result.err<InstallDetail, FilesystemProblem>(createProblem('filesystem.path.not-found', { path: registered.value.path }));
      });
   }

   function update(installId: InstallId, patch: InstallRecordPatch) {
      return mutations.run(async () => {
         await list();
         if (state.status !== 'ready') return Result.ok<InstallDetail | null, FilesystemProblem>(null);

         const detail = state.details.get(installId);
         if (!detail) return Result.ok<InstallDetail | null, FilesystemProblem>(null);
         const baseScan = state.scan;

         const updated = await store.update(installId, patch);
         if (Result.isError(updated)) return Result.err<InstallDetail | null, FilesystemProblem>(updated.error);
         if (!updated.value) return Result.ok<InstallDetail | null, FilesystemProblem>(null);

         if (patch.path !== undefined || state.status !== 'ready' || state.scan !== baseScan) {
            await rescan();
            return Result.ok<InstallDetail | null, FilesystemProblem>(state.status === 'ready' ? (state.details.get(installId) ?? null) : null);
         }

         const changed = {
            name: updated.value.name ?? detail.name,
            pinned: updated.value.pinned,
            color: updated.value.color,
            updatedAt: updated.value.updatedAt
         };
         const nextDetail = { ...detail, ...changed };
         const nextDetails = new Map(state.details);
         nextDetails.set(installId, nextDetail);
         const nextSnapshot: InstallRegistrySnapshot = {
            ...state.snapshot,
            installs: state.snapshot.installs.map((install) => (install.id === installId ? { ...install, ...changed } : install))
         };
         state = { status: 'ready', scan: baseScan, snapshot: nextSnapshot, details: nextDetails };
         emit(nextSnapshot);

         return Result.ok<InstallDetail | null, FilesystemProblem>(nextDetail);
      });
   }

   function reorder(installIds: InstallId[]) {
      return mutations.run(async () => {
         await list();
         if (state.status !== 'ready') {
            return Result.err<InstallRegistrySnapshot, FilesystemProblem>(createProblem('filesystem.path.not-found', { path: store.filePath }));
         }
         const baseScan = state.scan;

         const reordered = await store.reorder(installIds);
         if (Result.isError(reordered)) return Result.err<InstallRegistrySnapshot, FilesystemProblem>(reordered.error);

         if (state.status !== 'ready' || state.scan !== baseScan) {
            const refreshed = await rescan();
            return Result.ok<InstallRegistrySnapshot, FilesystemProblem>(refreshed);
         }

         const installs = new Map(state.snapshot.installs.map((install) => [install.id, install]));
         const reorderedInstalls = reordered.value.flatMap((record) => {
            const install = installs.get(record.id);
            return install ? [install] : [];
         });
         const nextSnapshot = { ...state.snapshot, installs: reorderedInstalls };
         state = { status: 'ready', scan: baseScan, snapshot: nextSnapshot, details: state.details };
         emit(nextSnapshot);

         return Result.ok<InstallRegistrySnapshot, FilesystemProblem>(nextSnapshot);
      });
   }

   function associateStore(installId: InstallId, detectedStore: StoreKind) {
      return mutations.run(async () => {
         const updated = await store.update(installId, { store: detectedStore });
         if (Result.isError(updated)) return Result.err<InstallDetail | null, FilesystemProblem>(updated.error);
         if (!updated.value) return Result.ok<InstallDetail | null, FilesystemProblem>(null);

         await rescan();
         return Result.ok<InstallDetail | null, FilesystemProblem>(state.status === 'ready' ? (state.details.get(installId) ?? null) : null);
      });
   }

   function forget(installId: InstallId) {
      return mutations.run(async () => {
         const removed = await store.remove(installId);
         if (Result.isError(removed)) return removed;

         await rescan();
         return removed;
      });
   }

   function subscribe(listener: (snapshot: InstallRegistrySnapshot) => void) {
      listeners.add(listener);

      return () => {
         listeners.delete(listener);
      };
   }

   function dispose() {
      state = { status: 'disposed' };
      unsubscribeSettings();
      listeners.clear();
   }

   async function runScan() {
      const settings = await options.settingsStore.getSnapshot();
      const installRoot = resolveFilesystemPath(settings.library.installRoot);
      const problems: InstallProblem[] = [];
      const records = await readRecords(problems);
      const scanned = await Promise.all(records.map((record) => describeInstall(record, problems)));

      const scannedSnapshot: InstallRegistrySnapshot = {
         installRoot,
         scannedAt: new Date().toISOString(),
         installs: scanned.map((detail) => installSummarySchema.parse(detail)),
         problems
      };
      return { snapshot: scannedSnapshot, details: new Map(scanned.map((detail) => [detail.id, detail])) };
   }

   async function readRecords(problems: InstallProblem[]) {
      const resolved = await store.resolveStoreCandidates(await options.detectStores());
      if (Result.isOk(resolved)) return resolved.value;

      const loaded = await store.load();
      if (Result.isOk(loaded)) {
         problems.push(createProblem('installs.registry.write-failed', { path: store.filePath, detail: resolved.error.detail }));
         return loaded.value;
      }

      problems.push(createProblem('installs.registry.read-failed', { path: store.filePath, detail: loaded.error.detail }));
      return [];
   }

   async function describeInstall(record: InstallRecord, problems: InstallProblem[]): Promise<InstallDetail> {
      const info = await readPathInfo(record.path);
      const missing = Result.isError(info) || info.value.kind !== 'directory';
      const version = missing ? null : await readBeatSaberVersion(record.path);
      const located = { installId: record.id, path: record.path };
      const problem: InstallProblem | undefined = missing
         ? createProblem('installs.path.unreadable', { ...located, detail: Result.isError(info) ? info.error.detail : undefined })
         : version
           ? undefined
           : createProblem('installs.version.unknown', located);
      if (problem) problems.push(problem);

      const detail: InstallDetail = {
         id: record.id,
         name:
            record.name === `Beat Saber ${version}`
               ? (version ?? record.name)
               : (record.name ?? version ?? stripMechanicalSuffix(basename(record.path))),
         pinned: record.pinned,
         version,
         store: record.store,
         source: record.source,
         path: record.path,
         color: record.color,
         status: missing ? 'missing' : version ? 'ready' : 'incomplete',
         createdAt: record.createdAt,
         updatedAt: record.updatedAt,
         aliases: record.aliases
      };
      if (problem) detail.problem = problem;
      return detail;
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
      reorder,
      associateStore,
      forget,
      subscribe,
      dispose
   };
}
