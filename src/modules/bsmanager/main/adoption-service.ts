import { Result } from 'better-result';

import type { IpcFailureResult } from '@/app/ipc/core';
import { isSamePath, resolveFilesystemPath, pathExistsSafely, readPathInfo } from '@/lib/filesystem/path';
import {
   invalidBSManagerPlan,
   type BSManagerAdoptInput,
   type BSManagerAdoptResult,
   type BSManagerCleanupInput,
   type BSManagerCleanupResult,
   type BSManagerDetection,
   type BSManagerFolderLink,
   type BSManagerIssue,
   type BSManagerPlan,
   type BSManagerVersion
} from '@/modules/bsmanager/contract';
import {
   bsmanagerStoreKind,
   bsmanagerVersionFolderName,
   readBSManagerAppConfig,
   readBSManagerConfig,
   readBSManagerVersionStore,
   type BSManagerConfigVersion
} from '@/modules/bsmanager/main/bsmanager-config';
import {
   bsmanagerAppConfigPath,
   bsmanagerConfigPath,
   bsmanagerRootCandidates,
   bsmanagerSharedContentPath,
   bsmanagerVersionsPath,
   type BSManagerLocations
} from '@/modules/bsmanager/main/bsmanager-paths';
import type { BSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import { customInstallName, stripMechanicalSuffix } from '@/modules/installs/main/naming';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import { sharedFolderDefinitions, sharedFolderRelativePath } from '@/modules/shared-content/contract';
import { readFolderLink } from '@/modules/shared-content/main/folder-link';
import { defaultSharedContentRootPath, installFolderPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';
import { localTargetId } from '@/modules/targets/contract';

import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

type AdoptionServiceOptions = {
   registry: InstallRegistry;
   settingsStore: SettingsStore;
   converter: BSManagerSharedContentConverter;
   locations: BSManagerLocations;
};

export type BSManagerAdoptionService = ReturnType<typeof createBSManagerAdoptionService>;

export function createBSManagerAdoptionService(options: AdoptionServiceOptions) {
   async function detect(): Promise<BSManagerDetection> {
      const resolved = await resolveRoot();

      if (!resolved.rootPath) {
         return { targetId: localTargetId, status: 'missing', rootPath: null, sharedContentPath: null, searchedPaths: resolved.searchedPaths };
      }

      const settings = await options.settingsStore.getSnapshot();
      const detectedSharedPath = bsmanagerSharedContentPath(resolved.rootPath);
      const activeSharedPath = settings.library.sharedRoot ?? defaultSharedContentRootPath(settings.library.installRoot);
      const sharedContentPath =
         [activeSharedPath, ...settings.library.sharedRoots].find((path) => isSamePath(path, detectedSharedPath)) ?? detectedSharedPath;

      return {
         targetId: localTargetId,
         status: 'detected',
         rootPath: resolved.rootPath,
         sharedContentPath,
         searchedPaths: resolved.searchedPaths
      };
   }

   async function plan(): Promise<BSManagerPlan> {
      const resolved = await resolveRoot();
      if (!resolved.rootPath) return invalidBSManagerPlan(localTargetId, '', 'not-found', resolved.searchedPaths.join(', '));

      const rootPath = resolved.rootPath;
      const versionsPath = bsmanagerVersionsPath(rootPath);
      const sharedContentPath = bsmanagerSharedContentPath(rootPath);
      const [appConfig, config, settings] = await Promise.all([
         readBSManagerAppConfig(bsmanagerAppConfigPath(options.locations)),
         readBSManagerConfig(bsmanagerConfigPath(rootPath)),
         options.settingsStore.getSnapshot()
      ]);
      const currentSharedRootPath = settings.library.sharedRoot ?? defaultSharedContentRootPath(settings.library.installRoot);
      const versions = await describeVersions(versionsPath, sharedContentPath, config['custom-versions']);

      if (versions.length === 0) return invalidBSManagerPlan(localTargetId, rootPath, 'nothing-to-adopt');

      return {
         status: 'ok',
         targetId: localTargetId,
         rootPath,
         versionsPath,
         sharedContentPath,
         currentSharedRootPath,
         sharedRootAdopted: isSamePath(currentSharedRootPath, sharedContentPath),
         useSymlinks: appConfig['use-symlinks'] ?? false,
         versions
      };
   }

   async function adopt(request: BSManagerAdoptInput): Promise<BSManagerAdoptResult> {
      const planned = await plan();
      if (planned.status === 'invalid') return failure(planned.issue, planned.detail);

      const wanted = new Set(request.versionIds);
      const selected = planned.versions.filter((version) => wanted.has(version.id) && version.status === 'ready');
      if (selected.length === 0) return failure('nothing-selected');

      let adopted = 0;

      for (const version of selected) {
         const registered = await options.registry.register({
            source: 'bsmanager',
            path: version.path,
            color: version.color,
            store: version.store
         });
         if (Result.isError(registered)) return failure('register-failed', registered.error.detail ?? registered.error.message);

         adopted += 1;
      }

      if (request.adoptSharedRoot) {
         const settings = await options.settingsStore.getSnapshot();
         const knownRoots = settings.library.sharedRoots.filter((root) => !isSamePath(root, planned.sharedContentPath));
         // the previous root stays known when it exists on disk, so links into it stay healthy
         const keepPrevious =
            !planned.sharedRootAdopted &&
            !knownRoots.some((root) => isSamePath(root, planned.currentSharedRootPath)) &&
            (await pathExistsSafely(planned.currentSharedRootPath));
         const written = await options.settingsStore.updateLibrarySettings({
            sharedRoot: planned.sharedContentPath,
            sharedRoots: keepPrevious ? [...knownRoots, planned.currentSharedRootPath] : knownRoots,
            useSymlinks: planned.useSymlinks
         });
         if (!written.ok) return failure('register-failed', written.error.message);
      }

      return {
         ok: true,
         value: {
            rootPath: planned.rootPath,
            sharedRootPath: request.adoptSharedRoot ? planned.sharedContentPath : planned.currentSharedRootPath,
            adopted,
            skipped: planned.versions.length - adopted
         }
      };
   }

   async function cleanup(request: BSManagerCleanupInput): Promise<BSManagerCleanupResult> {
      const planned = await plan();
      if (planned.status === 'invalid') return failure(planned.issue, planned.detail);
      if (!isSamePath(request.rootPath, planned.rootPath)) return failure('not-bsmanager');

      const versions = planned.versions.filter((version) => version.status !== 'missing');
      const started = options.converter.start(planned, versions);
      return Result.isError(started) ? failure(started.error) : { ok: true, value: started.value };
   }

   async function migrateInstallStores() {
      const resolved = await resolveRoot();
      if (!resolved.rootPath) return;

      const [config, registered] = await Promise.all([readBSManagerConfig(bsmanagerConfigPath(resolved.rootPath)), options.registry.list()]);

      for (const install of registered.installs) {
         if (install.source !== 'bsmanager' || install.store) continue;

         const name = basename(install.path);
         const match = config['custom-versions'].find((version) => bsmanagerVersionFolderName(version) === name) ?? null;
         const detectedStore = bsmanagerStoreKind(match, await readBSManagerVersionStore(install.path));
         await options.registry.associateStore(install.id, detectedStore);
      }
   }

   async function describeVersions(versionsPath: string, sharedContentPath: string, configured: BSManagerConfigVersion[]) {
      const entries = await Result.tryPromise({
         try: () => readdir(versionsPath, { withFileTypes: true }),
         catch: (cause) => cause
      });
      const folderNames = Result.isOk(entries)
         ? entries.value.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name)
         : [];
      const names = [...new Set([...folderNames, ...configured.map((version) => bsmanagerVersionFolderName(version))])].sort();
      const registered = await options.registry.list();
      const versions: BSManagerVersion[] = [];

      for (const name of names) {
         const path = resolveFilesystemPath(join(versionsPath, name));
         const match = configured.find((version) => bsmanagerVersionFolderName(version) === name) ?? null;
         const install = registered.installs.find((candidate) => isSamePath(candidate.path, path)) ?? null;
         const exists = await pathExistsSafely(path);
         const store = bsmanagerStoreKind(match, exists ? await readBSManagerVersionStore(path) : null);

         if (install && !install.store) await options.registry.associateStore(install.id, store);

         versions.push({
            id: name,
            name: customInstallName(name),
            version: stripMechanicalSuffix(match?.BSVersion ?? name),
            path,
            store,
            color: match?.color ?? null,
            status: install ? 'adopted' : exists ? 'ready' : 'missing',
            installId: install?.id ?? null,
            folders: exists ? await describeFolders(path, sharedContentPath) : []
         });
      }

      return versions;
   }

   async function describeFolders(installPath: string, sharedContentPath: string) {
      const folders: BSManagerFolderLink[] = [];

      for (const definition of sharedFolderDefinitions) {
         const link = await readFolderLink(installFolderPath(installPath, definition), sharedFolderPath(sharedContentPath, definition));

         folders.push({
            id: definition.id,
            relativePath: sharedFolderRelativePath(definition),
            state: link.state,
            linkTargetPath: link.linkTargetPath
         });
      }

      return folders;
   }

   async function resolveRoot(): Promise<{ rootPath: string | null; searchedPaths: string[] }> {
      const appConfig = await readBSManagerAppConfig(bsmanagerAppConfigPath(options.locations));
      const candidates = bsmanagerRootCandidates(options.locations, appConfig['installation-folder']);
      const searchedPaths: string[] = [];

      for (const candidate of candidates) {
         searchedPaths.push(candidate);
         if (await looksLikeBSManagerRoot(candidate)) return { rootPath: resolveFilesystemPath(candidate), searchedPaths };
      }

      return { rootPath: null, searchedPaths };
   }

   async function looksLikeBSManagerRoot(candidate: string) {
      const info = await readPathInfo(candidate);
      if (Result.isError(info) || info.value.kind !== 'directory') return false;

      return (await pathExistsSafely(bsmanagerVersionsPath(candidate))) || (await pathExistsSafely(bsmanagerConfigPath(candidate)));
   }

   return { detect, plan, adopt, cleanup, migrateInstallStores };
}

function failure(issue: BSManagerIssue, detail?: string): IpcFailureResult {
   return {
      ok: false,
      error: {
         code: `bsmanager.${issue}`,
         message: issueMessages[issue],
         ...(detail ? { details: { detail } } : {})
      }
   };
}

const issueMessages: Record<BSManagerIssue, string> = {
   'inspect-failed': 'the BSManager folder could not be read',
   'not-bsmanager': 'that folder does not look like a BSManager folder',
   'not-found': 'no BSManager folder was found',
   'nothing-selected': 'nothing was selected to adopt',
   'nothing-to-clean': 'there are no BSManager folder links to clean up',
   'nothing-to-adopt': 'this BSManager folder holds no versions',
   'register-failed': 'the install registry could not be saved',
   'unsupported-target': 'this target cannot adopt a BSManager setup'
};
