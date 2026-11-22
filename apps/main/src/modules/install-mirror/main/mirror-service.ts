import { Result } from 'better-result';

import { openZipArchive, type ZipArchive } from '@/lib/archive/zip-read';
import { abortableSleep } from '@/lib/async';
import { causeCode, createProblem, type Problem } from '@/lib/errors';
import { deletePathWithProgress } from '@/lib/filesystem/operations';
import { isPathInside, isSamePath, pathExists, removeQuietly } from '@/lib/filesystem/path';
import { bytesProgress } from '@/lib/progress';
import { installMirrorApi } from '@/modules/install-mirror/api';
import {
   mirrorBatchLimit,
   type MirrorBatchRequest,
   type MirrorEntry,
   type MirrorFileRequest,
   type MirrorInstallPlan,
   type MirrorLink,
   type MirrorManifestPage,
   type MirrorManifestRequest,
   type MirrorPreview,
   type MirrorRequest,
   type MirrorSection,
   type MirrorStartRequest
} from '@/modules/install-mirror/contract';
import { fromMirrorPath, toMirrorPath } from '@/modules/install-mirror/main/mirror-source';
import { installsApi } from '@/modules/installs/api';
import type { InstallDetail } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { OperationId } from '@/modules/operations/contract';
import type { OperationRegistry } from '@/modules/operations/main/operation-registry';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { defaultSharedContentRootPath } from '@/modules/shared-content/main/shared-paths';
import { beatSaberSteamAppId, type SteamClientState } from '@/modules/stores/main/steam-client';
import type { TargetId } from '@/modules/targets/contract';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, readlink, realpath, rename, rm, rmdir, stat, symlink, unlink, utimes } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const parallelDownloads = 6;
const rateWindowMs = 5_000;
const stagingPrefix = '.encore-staging-';
const backupPrefix = '.encore-backup-';

export type MirrorRemote = {
   name: (targetId: TargetId) => string;
   detail: (targetId: TargetId, installId: string) => Promise<InstallDetail | null>;
   manifest: (targetId: TargetId, request: MirrorManifestRequest) => Promise<Result<MirrorManifestPage, Problem>>;
   readFile: (targetId: TargetId, request: MirrorFileRequest, destinationPath: string, signal: AbortSignal) => Promise<boolean>;
   readBatch: (targetId: TargetId, request: MirrorBatchRequest, destinationPath: string, signal: AbortSignal) => Promise<boolean>;
};

export function mirrorRemoteFrom(registry: Pick<TargetRegistry, 'callTarget' | 'downloadTarget' | 'listTargets'>): MirrorRemote {
   return {
      name: (targetId) => registry.listTargets().find((target) => target.id === targetId)?.name ?? targetId,
      detail: async (targetId, installId) => {
         const detail = await registry.callTarget(installsApi, 'getDetail', targetId, { installId });
         return detail.status === 'ok' ? detail.value : null;
      },
      manifest: async (targetId, request) => {
         const page = await registry.callTarget(installMirrorApi, 'manifest', targetId, request);
         if (page.status !== 'ok') return Result.err(createProblem('mirror.source-unavailable'));
         return page.value.ok ? Result.ok(page.value.value) : Result.err(page.value.error);
      },
      readFile: async (targetId, request, destinationPath, signal) =>
         (await registry.downloadTarget(installMirrorApi, 'readFile', targetId, request, destinationPath, signal)).status === 'ok',
      readBatch: async (targetId, request, destinationPath, signal) =>
         (await registry.downloadTarget(installMirrorApi, 'readBatch', targetId, request, destinationPath, signal)).status === 'ok'
   };
}

type Plan = {
   installId: string;
   section: MirrorSection;
   root: string;
   staging: string;
   backup: string;
   download: MirrorEntry[];
   extras: string[];
   strayLinks: string[];
};
type LocalTree = { files: Map<string, { size: number; mtimeMs: number }>; links: Set<string> };
type Undo = () => Promise<void>;

export function createMirrorService(options: {
   remote: MirrorRemote;
   installs: InstallRegistry;
   settingsStore: SettingsStore;
   operations: OperationRegistry;
   platform: NodeJS.Platform;
   appDataPath: string;
   stagingRoot: string;
   readSteam: () => Promise<SteamClientState>;
   openSteamLink: (link: string) => Promise<boolean>;
   ensureProton: () => Promise<boolean>;
}) {
   const { remote } = options;
   let running = false;
   const steamCleanups = new Map<string, AbortController>();

   async function preview(request: MirrorRequest): Promise<Result<MirrorPreview, Problem>> {
      if (options.platform !== 'linux') return Result.err(createProblem('mirror.unsupported-platform'));

      const sources = await Promise.all(request.sourceInstallIds.map((installId) => remote.detail(request.sourceTargetId, installId)));
      if (sources.some((source) => !source)) return Result.err(createProblem('mirror.source-unavailable'));
      if (sources.some((source) => source?.store !== 'steam' || !source.version)) return Result.err(createProblem('mirror.steam-only'));
      if ((await options.readSteam()).status === 'missing') return Result.err(createProblem('mirror.steam-missing'));

      const library = (await options.settingsStore.getSnapshot()).library;
      const local = (await options.installs.list()).installs;
      const used = new Set<string>();
      const installs: MirrorInstallPlan[] = [];
      for (const source of sources) {
         if (!source?.version) continue;
         const record = library.mirrors.find(
            (mirror) =>
               mirror.targetId === request.sourceTargetId && mirror.installId === source.id && local.some((install) => install.path === mirror.path)
         );
         const taken = async (path: string) => {
            if (used.has(path) || library.mirrors.some((mirror) => mirror.path === path && mirror.installId !== source.id)) return true;
            const exists = await pathExists(path);
            return Result.isError(exists) || exists.value;
         };
         let destinationPath = record?.path ?? join(library.installRoot, `Beat Saber ${source.version}`);
         for (let copy = 2; !record && (await taken(destinationPath)); copy += 1)
            destinationPath = join(library.installRoot, `Beat Saber ${source.version} (${copy})`);
         used.add(destinationPath);
         installs.push({
            sourceInstallId: source.id,
            name: source.name,
            color: source.color,
            version: source.version,
            destinationPath,
            resync: Boolean(record)
         });
      }

      const sharedRoot = library.sharedRoot ?? defaultSharedContentRootPath(library.installRoot);
      const removals = request.replaceOthers ? local.filter((install) => !used.has(install.path)) : [];

      const kept = await Promise.all([...used, sharedRoot, options.appDataPath].map(canonicalPath));
      if (kept.some((path, index) => kept.some((other, otherIndex) => index !== otherIndex && pathsOverlap(path, other)))) {
         return Result.err(createProblem('mirror.overlap', { path: sharedRoot }));
      }
      for (const install of removals) {
         const removed = await canonicalPath(install.path);
         if (kept.some((path) => pathsOverlap(removed, path))) return Result.err(createProblem('mirror.overlap', { path: install.path }));
      }

      const planned = {
         installs,
         sharedRoot,
         appDataPath: options.appDataPath,
         removals: removals.map((install) => ({ installId: install.id, name: install.name, path: install.path, store: install.source === 'store' }))
      };
      const targets = { kept, removals: await Promise.all(removals.map((install) => canonicalPath(install.path))) };
      return Result.ok({
         sourceDevice: remote.name(request.sourceTargetId),
         resync: installs.every((install) => install.resync),
         ...planned,
         planKey: createHash('sha256').update(JSON.stringify({ planned, targets })).digest('hex')
      });
   }

   async function start(request: MirrorStartRequest) {
      if (running) return Result.err(createProblem('mirror.busy'));
      const previewed = await preview(request);
      if (Result.isError(previewed)) return Result.err(previewed.error);
      if (running) return Result.err(createProblem('mirror.busy'));
      if (previewed.value.planKey !== request.planKey) return Result.err(createProblem('mirror.plan-changed'));

      running = true;
      const names = previewed.value.installs.map((install) => install.name).join(', ');
      const operation = options.operations.start(
         {
            kind: 'copy',
            title: `${previewed.value.sourceDevice} · ${names}`,
            message: previewed.value.installs.map((install) => install.destinationPath).join(', '),
            progress: { phase: 'scanning', current: 0, unit: 'files' }
         },
         (operationId, signal) =>
            run(operationId, request, previewed.value, signal).finally(() => {
               running = false;
            })
      );
      return Result.ok(operation);
   }

   async function run(operationId: OperationId, request: MirrorRequest, plan: MirrorPreview, signal: AbortSignal) {
      const runId = randomUUID().slice(0, 8);
      const plans: Plan[] = [];
      const placements: { destinationPath: string; links: MirrorLink[] }[] = [];
      const fail = async (problem: Problem) => {
         await clearStaging(plans);
         options.operations.fail(operationId, problem);
      };

      const shared = new Map<string, { installId: string; link: MirrorLink }>();
      for (const install of plan.installs) {
         if (signal.aborted) return clearStaging(plans);
         const planned = await planSection(
            request,
            install.sourceInstallId,
            { kind: 'install' },
            install.destinationPath,
            runId,
            plans.length,
            signal
         );
         if (Result.isError(planned)) return signal.aborted ? clearStaging(plans) : fail(planned.error);
         if (planned.value.sourceFiles === 0) return fail(createProblem('mirror.source-unreadable', { path: install.name }));
         plans.push(planned.value.plan);
         placements.push({ destinationPath: install.destinationPath, links: planned.value.links });
         for (const link of planned.value.links)
            if (!shared.has(link.sharedPath)) shared.set(link.sharedPath, { installId: install.sourceInstallId, link });
      }

      const sharedPaths = [...shared.keys()];
      if (sharedPaths.some((path) => sharedPaths.some((other) => other !== path && other.startsWith(`${path}/`)))) {
         return fail(createProblem('mirror.overlap', { path: plan.sharedRoot }));
      }
      for (const [sharedPath, { installId, link }] of shared) {
         if (signal.aborted) return clearStaging(plans);
         const section: MirrorSection = { kind: 'link', path: link.path };
         const linked = await planSection(request, installId, section, fromMirrorPath(plan.sharedRoot, sharedPath), runId, plans.length, signal);
         if (Result.isError(linked)) return signal.aborted ? clearStaging(plans) : fail(linked.error);
         plans.push(linked.value.plan);
      }
      const first = plan.installs[0];
      if (!first) return fail(createProblem('mirror.source-unavailable'));
      if (signal.aborted) return clearStaging(plans);
      const appData = await planSection(request, first.sourceInstallId, { kind: 'appdata' }, plan.appDataPath, runId, plans.length, signal);
      if (Result.isError(appData)) return signal.aborted ? clearStaging(plans) : fail(appData.error);
      if (appData.value.sourceFiles > 0) plans.push(appData.value.plan);
      const roots = await Promise.all(plans.map((section) => canonicalPath(section.root)));
      const nested = roots.find((root, index) => roots.some((other, otherIndex) => index !== otherIndex && pathsOverlap(root, other)));
      if (nested) return fail(createProblem('mirror.overlap', { path: nested }));
      await clearLeftovers(plans);
      if (signal.aborted) return;

      const total = plans.reduce((sum, section) => sum + section.download.reduce((bytes, entry) => bytes + entry.size, 0), 0);
      const recent: { at: number; bytes: number }[] = [];
      let done = 0;
      const report = () => {
         const now = Date.now();
         recent.push({ at: now, bytes: done });
         while (recent.length > 2 && now - (recent[0]?.at ?? now) > rateWindowMs) recent.shift();
         const oldest = recent[0];
         const perSecond = oldest && now > oldest.at ? ((done - oldest.bytes) * 1000) / (now - oldest.at) : undefined;
         options.operations.update(operationId, { progress: { ...bytesProgress('downloading', done, total), perSecond } });
      };

      for (const section of plans) {
         const copied = await downloadAll(request, section, signal, (bytes) => {
            done += bytes;
            report();
         });
         if (Result.isError(copied)) return fail(copied.error);
         if (signal.aborted) return clearStaging(plans);
      }

      options.operations.update(operationId, { cancelable: false, progress: { phase: 'linking', current: 0, unit: 'steps' } });
      const undo: Undo[] = [];
      const committed = await Result.tryPromise({
         try: () => commit(plans, placements, plan.sharedRoot, undo),
         catch: (cause) => createProblem('mirror.link-failed', { path: plan.sharedRoot, cause })
      });
      const outcome = Result.isOk(committed) ? committed.value : Result.err<void, Problem>(committed.error);
      if (Result.isError(outcome)) {
         let restored = true;
         for (const step of undo.toReversed()) if (Result.isError(await Result.tryPromise(step))) restored = false;
         if (restored) await clearBackups(plans);
         return fail(restored ? outcome.error : createProblem('mirror.restore-incomplete', { path: first.destinationPath }));
      }
      await clearStaging(plans);

      const registered = await registerMirrors(request, plan);
      if (Result.isError(registered)) {
         let restored = true;
         for (const step of undo.toReversed()) if (Result.isError(await Result.tryPromise(step))) restored = false;
         if (restored) await clearBackups(plans);
         return fail(restored ? registered.error : createProblem('mirror.restore-incomplete', { path: first.destinationPath }));
      }
      await clearBackups(plans);
      options.operations.update(operationId, { progress: { phase: 'removing', current: 0, total: plan.removals.length, unit: 'items' } });

      for (const [index, removal] of plan.removals.entries()) {
         if (removal.store) {
            await uninstallStoreCopy(removal.path);
         } else {
            const removed = await deletePathWithProgress({ targetPath: removal.path, root: dirname(removal.path), allowMissing: true });
            if (Result.isError(removed)) return options.operations.fail(operationId, removed.error);
            const forgotten = await options.installs.forget(removal.installId);
            if (Result.isError(forgotten)) return options.operations.fail(operationId, forgotten.error);
         }
         if (index + 1 < plan.removals.length) {
            options.operations.update(operationId, {
               progress: { phase: 'removing', current: index + 1, total: plan.removals.length, unit: 'items' }
            });
         }
      }

      options.operations.complete(operationId, { installIds: registered.value, bytes: done, protonRequested: await options.ensureProton() });
   }

   async function planSection(
      request: MirrorRequest,
      installId: string,
      section: MirrorSection,
      root: string,
      runId: string,
      index: number,
      signal: AbortSignal
   ) {
      const remote = await fetchManifest(request, installId, section, signal);
      if (Result.isError(remote)) return Result.err<{ plan: Plan; links: MirrorLink[]; sourceFiles: number }, Problem>(remote.error);

      const local = await readLocalTree(root);
      if (Result.isError(local)) return Result.err<{ plan: Plan; links: MirrorLink[]; sourceFiles: number }, Problem>(local.error);
      const linkPaths = new Set(remote.value.links.map((link) => link.path));
      const wanted = new Set(remote.value.entries.map((entry) => entry.path));
      const download = remote.value.entries.filter((entry) => {
         const existing = local.value.files.get(entry.path);
         return !existing || existing.size !== entry.size || Math.trunc(existing.mtimeMs) !== Math.trunc(entry.mtimeMs);
      });
      const extras = [...local.value.files.keys()].filter((path) => !wanted.has(path) && !underAny(path, linkPaths));
      const strayLinks = [...local.value.links].filter((path) => !linkPaths.has(path));
      const real = await canonicalPath(root);

      return Result.ok<{ plan: Plan; links: MirrorLink[]; sourceFiles: number }, Problem>({
         plan: {
            installId,
            section,
            root,
            staging: join(real, `${stagingPrefix}${process.pid}-${runId}-${index}`),
            backup: join(real, `${backupPrefix}${process.pid}-${runId}-${index}`),
            download,
            extras,
            strayLinks
         },
         links: remote.value.links,
         sourceFiles: remote.value.entries.length
      });
   }

   async function fetchManifest(
      request: MirrorRequest,
      installId: string,
      section: MirrorSection,
      signal: AbortSignal
   ): Promise<Result<{ entries: MirrorEntry[]; links: MirrorLink[] }, Problem>> {
      const entries: MirrorEntry[] = [];
      let links: MirrorLink[] = [];
      let walkId: string | undefined;

      for (let offset: number | null = 0; offset !== null;) {
         if (signal.aborted) return Result.err(createProblem('mirror.source-unavailable'));
         const page = await remote.manifest(request.sourceTargetId, { installId, section, walkId, offset });
         if (Result.isError(page)) return Result.err(page.error);
         entries.push(...page.value.entries);
         if (offset === 0) links = page.value.links;
         walkId = page.value.walkId;
         offset = page.value.next;
      }

      return Result.ok({ entries, links });
   }

   async function downloadAll(request: MirrorRequest, plan: Plan, signal: AbortSignal, onBytes: (bytes: number) => void) {
      const queue = batchEntries(plan.download);
      let problem: Problem | null = null;

      const worker = async () => {
         for (let batch = queue.shift(); batch && !problem && !signal.aborted; batch = queue.shift()) {
            const current = batch;
            const size = current.reduce((bytes, entry) => bytes + entry.size, 0);
            let counted = 0;
            const grown = (written: number) => {
               const next = Math.min(written, size);
               if (next > counted) onBytes(next - counted);
               counted = Math.max(counted, next);
            };
            const attempt = await Result.tryPromise({
               try: () =>
                  current.length === 1 && current[0]
                     ? fetchFile(request, plan, current[0], signal, grown)
                     : fetchBatch(request, plan, current, signal, grown),
               catch: () => createProblem('mirror.download-failed', { path: current[0]?.path ?? '' })
            });
            const fetched = Result.isOk(attempt) ? attempt.value : Result.err<void, Problem>(attempt.error);
            if (Result.isError(fetched)) {
               if (!signal.aborted) problem ??= fetched.error;
               return;
            }
            grown(size);
         }
      };

      await Promise.all(Array.from({ length: parallelDownloads }, worker));
      return problem ? Result.err<void, Problem>(problem) : Result.ok<void, Problem>(undefined);
   }

   async function fetchFile(
      request: MirrorRequest,
      plan: Plan,
      entry: MirrorEntry,
      signal: AbortSignal,
      grown: (written: number) => void
   ): Promise<Result<void, Problem>> {
      const path = fromMirrorPath(plan.staging, entry.path);
      await mkdir(dirname(path), { recursive: true });
      const downloaded = await whileGrowing(path, grown, () =>
         remote.readFile(request.sourceTargetId, { installId: plan.installId, section: plan.section, path: entry.path }, path, signal)
      );
      return downloaded ? Result.ok(undefined) : Result.err(createProblem('mirror.download-failed', { path: entry.path }));
   }

   async function fetchBatch(
      request: MirrorRequest,
      plan: Plan,
      batch: MirrorEntry[],
      signal: AbortSignal,
      grown: (written: number) => void
   ): Promise<Result<void, Problem>> {
      const failed = () => createProblem('mirror.download-failed', { path: batch[0]?.path ?? '' });
      await mkdir(options.stagingRoot, { recursive: true });
      const archivePath = join(options.stagingRoot, `${randomUUID()}.zip`);
      try {
         const downloaded = await whileGrowing(archivePath, grown, () =>
            remote.readBatch(
               request.sourceTargetId,
               { installId: plan.installId, section: plan.section, paths: batch.map((entry) => entry.path) },
               archivePath,
               signal
            )
         );
         if (!downloaded) return Result.err(failed());

         const archive = await openZipArchive(archivePath, { maxEntries: batch.length });
         if (Result.isError(archive)) return Result.err(failed());
         const unpacked = await unpack(archive.value, plan.staging, new Map(batch.map((entry) => [entry.path, entry])), signal);
         archive.value.close();
         return unpacked;
      } finally {
         await rm(archivePath, { force: true });
      }
   }

   async function registerMirrors(request: MirrorRequest, plan: MirrorPreview): Promise<Result<string[], Problem>> {
      await options.installs.rescan();
      const registered: string[] = [];
      for (const install of plan.installs) {
         const existing = (await options.installs.list()).installs.find((candidate) => candidate.path === install.destinationPath);
         const id = existing
            ? Result.ok<string, Problem>(existing.id)
            : (await options.installs.register({ source: 'library', path: install.destinationPath, store: 'steam' })).map((detail) => detail.id);
         if (Result.isError(id)) return Result.err(id.error);
         const named = await options.installs.update(id.value, { name: install.name, color: install.color });
         if (Result.isError(named)) return Result.err(named.error);
         registered.push(id.value);
      }

      const removed = new Set(plan.removals.map((removal) => removal.path));
      const recorded = await options.settingsStore.updateLibrarySettingsWith((library) => ({
         mirrors: [
            ...library.mirrors.filter(
               (mirror) => !removed.has(mirror.path) && !plan.installs.some((install) => install.destinationPath === mirror.path)
            ),
            ...plan.installs.map((install) => ({
               targetId: request.sourceTargetId,
               installId: install.sourceInstallId,
               path: install.destinationPath
            }))
         ]
      }));
      return recorded.ok ? Result.ok(registered) : Result.err(createProblem('mirror.link-failed', { path: plan.sharedRoot }));
   }

   async function uninstallStoreCopy(installPath: string) {
      const tree = await readLocalTree(installPath);
      if (Result.isError(tree)) return;
      for (const link of tree.value.links) {
         const removed = await Result.tryPromise(() => unlink(fromMirrorPath(installPath, link)));
         if (Result.isError(removed)) return;
      }
      await options.openSteamLink(`steam://uninstall/${beatSaberSteamAppId}`);
      void clearAfterSteam(installPath);
   }

   async function clearAfterSteam(installPath: string) {
      steamCleanups.get(installPath)?.abort();
      const controller = new AbortController();
      steamCleanups.set(installPath, controller);

      try {
         const manifest = join(dirname(dirname(installPath)), `appmanifest_${beatSaberSteamAppId}.acf`);
         for (let attempt = 0; attempt < 180 && !controller.signal.aborted; attempt += 1) {
            await abortableSleep(5000, controller.signal);
            if (controller.signal.aborted) return;
            const present = await pathExists(manifest);
            if (Result.isError(present) || present.value) continue;
            await removeQuietly(installPath);
            await options.installs.rescan();
            return;
         }
      } finally {
         if (steamCleanups.get(installPath) === controller) steamCleanups.delete(installPath);
      }
   }

   function dispose() {
      for (const controller of steamCleanups.values()) controller.abort();
      steamCleanups.clear();
   }

   return { preview, start, dispose };
}

async function commit(
   plans: Plan[],
   placements: { destinationPath: string; links: MirrorLink[] }[],
   sharedRoot: string,
   undo: Undo[]
): Promise<Result<void, Problem>> {
   for (const section of plans) {
      for (const entry of section.download) {
         const staged = await Result.tryPromise(() => stat(fromMirrorPath(section.staging, entry.path)));
         if (Result.isError(staged) || staged.value.size !== entry.size) {
            return Result.err(createProblem('mirror.download-failed', { path: entry.path }));
         }
      }
   }

   for (const section of plans) {
      for (const link of section.strayLinks) {
         const path = fromMirrorPath(section.root, link);
         const target = await readlink(path);
         await unlink(path);
         undo.push(() => symlink(target, path));
      }
      for (const extra of section.extras) await displace(section, extra, undo);
      for (const extra of section.extras) await pruneEmpty(section.root, extra);
      for (const entry of section.download) {
         const path = fromMirrorPath(section.root, entry.path);
         await displace(section, entry.path, undo);
         await makeParents(path, undo);
         await rename(fromMirrorPath(section.staging, entry.path), path);
         undo.push(() => rm(path, { force: true }));
         await utimes(path, new Date(), new Date(entry.mtimeMs));
      }
   }

   for (const [index, placement] of placements.entries()) {
      const installSection = plans[index];
      if (!installSection) continue;
      for (const link of placement.links) {
         const path = fromMirrorPath(placement.destinationPath, link.path);
         const target = fromMirrorPath(sharedRoot, link.sharedPath);
         await mkdir(target, { recursive: true });
         const existing = await lstat(path).catch(() => null);
         if (existing?.isSymbolicLink()) {
            const previous = await readlink(path);
            await unlink(path);
            undo.push(() => symlink(previous, path));
         } else if (existing) {
            await displace(installSection, link.path, undo);
         }
         await makeParents(path, undo);
         await symlink(target, path, 'dir');
         undo.push(() => unlink(path));
      }
   }
   return Result.ok(undefined);
}

async function displace(section: Plan, relative: string, undo: Undo[]) {
   const path = fromMirrorPath(section.root, relative);
   const aside = fromMirrorPath(join(section.backup, String(undo.length)), relative);
   const exists = await lstat(path).catch(() => null);
   if (!exists) return;
   await mkdir(dirname(aside), { recursive: true });
   await rename(path, aside);
   undo.push(async () => {
      await mkdir(dirname(path), { recursive: true });
      await rename(aside, path);
   });
}

async function makeParents(path: string, undo: Undo[]) {
   const created = await mkdir(dirname(path), { recursive: true });
   if (created) undo.push(() => rm(created, { recursive: true, force: true }));
}

async function whileGrowing<Value>(path: string, grown: (written: number) => void, task: () => Promise<Value>) {
   const timer = setInterval(() => {
      stat(path).then(
         (info) => grown(info.size),
         () => undefined
      );
   }, 500);
   try {
      return await task();
   } finally {
      clearInterval(timer);
   }
}

async function clearStaging(plans: Plan[]) {
   for (const plan of plans) await rm(plan.staging, { recursive: true, force: true });
}

async function clearBackups(plans: Plan[]) {
   for (const plan of plans) await rm(plan.backup, { recursive: true, force: true });
}

async function clearLeftovers(plans: Plan[]) {
   for (const parent of new Set(plans.map((plan) => dirname(plan.staging)))) {
      const listed = await Result.tryPromise(() => readdir(parent));
      if (Result.isError(listed)) continue;
      for (const name of listed.value) {
         if (!name.startsWith(stagingPrefix)) continue;
         const owner = Number(name.slice(stagingPrefix.length).split('-')[0]);
         if (owner !== process.pid && isAlive(owner)) continue;
         if (owner === process.pid && plans.some((plan) => plan.staging === join(parent, name))) continue;
         await rm(join(parent, name), { recursive: true, force: true });
      }
   }
}

function isAlive(pid: number) {
   if (!Number.isInteger(pid) || pid <= 0) return false;
   return Result.try(() => process.kill(pid, 0)).isOk();
}

async function unpack(archive: ZipArchive, staging: string, expected: Map<string, MirrorEntry>, signal: AbortSignal): Promise<Result<void, Problem>> {
   for (const record of archive.records) {
      if (signal.aborted) return Result.err(createProblem('mirror.download-failed', { path: record.name }));
      const entry = expected.get(record.name);
      if (!entry) continue;

      const path = fromMirrorPath(staging, entry.path);
      const opened = await archive.openEntryStream(record);
      if (Result.isError(opened)) return Result.err(createProblem('mirror.download-failed', { path: entry.path }));
      const written = await Result.tryPromise({
         try: async () => {
            await mkdir(dirname(path), { recursive: true });
            await pipeline(opened.value, createWriteStream(path));
         },
         catch: () => createProblem('mirror.download-failed', { path: entry.path })
      });
      if (Result.isError(written)) return written;
   }
   return Result.ok(undefined);
}

function batchEntries(entries: MirrorEntry[]) {
   const batches: MirrorEntry[][] = [];
   let current: MirrorEntry[] = [];
   let bytes = 0;
   let pathBytes = 0;

   for (const entry of entries) {
      const cost = Buffer.byteLength(JSON.stringify(entry.path)) + 1;
      if (entry.size >= mirrorBatchLimit.largeFileBytes) {
         batches.push([entry]);
         continue;
      }
      if (
         current.length > 0 &&
         (current.length >= mirrorBatchLimit.files || bytes + entry.size > mirrorBatchLimit.bytes || pathBytes + cost > mirrorBatchLimit.pathBytes)
      ) {
         batches.push(current);
         current = [];
         bytes = 0;
         pathBytes = 0;
      }
      current.push(entry);
      bytes += entry.size;
      pathBytes += cost;
   }
   if (current.length > 0) batches.push(current);
   return batches;
}

async function pruneEmpty(root: string, extra: string) {
   const segments = extra.split('/').slice(0, -1);
   while (segments.length > 0) {
      const emptied = await Result.tryPromise({ try: () => rmdir(fromMirrorPath(root, segments.join('/'))), catch: causeCode });
      if (Result.isError(emptied)) return;
      segments.pop();
   }
}

async function canonicalPath(path: string) {
   const rest: string[] = [];
   for (let current = path; ; current = dirname(current)) {
      const resolved = await Result.tryPromise(() => realpath(current));
      if (Result.isOk(resolved)) return join(resolved.value, ...rest.toReversed());
      if (dirname(current) === current) return path;
      rest.push(basename(current));
   }
}

function pathsOverlap(first: string, second: string) {
   return isSamePath(first, second) || isPathInside(first, second) || isPathInside(second, first);
}

function underAny(path: string, roots: Set<string>) {
   for (const root of roots) if (path.startsWith(`${root}/`)) return true;
   return false;
}

async function readLocalTree(root: string): Promise<Result<LocalTree, Problem>> {
   const files = new Map<string, { size: number; mtimeMs: number }>();
   const links = new Set<string>();
   let unreadable: string | null = null;

   async function visit(directory: string) {
      const listed = await Result.tryPromise({ try: () => readdir(directory, { withFileTypes: true }), catch: causeCode });
      if (Result.isError(listed)) {
         if (!(directory === root && listed.error === 'ENOENT')) unreadable ??= directory;
         return;
      }
      for (const dirent of listed.value) {
         if (directory === root && (dirent.name.startsWith(stagingPrefix) || dirent.name.startsWith(backupPrefix))) continue;
         const path = join(directory, dirent.name);
         if (dirent.isSymbolicLink()) links.add(toMirrorPath(root, path));
         else if (dirent.isDirectory()) await visit(path);
         else if (dirent.isFile()) {
            const info = await Result.tryPromise(() => stat(path));
            if (Result.isOk(info)) files.set(toMirrorPath(root, path), { size: info.value.size, mtimeMs: info.value.mtimeMs });
         }
      }
   }

   await visit(root);
   return unreadable ? Result.err(createProblem('mirror.local-unreadable', { path: unreadable })) : Result.ok({ files, links });
}
