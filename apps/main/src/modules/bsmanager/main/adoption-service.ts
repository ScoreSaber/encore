import { Result } from 'better-result';

import type { IpcFailureResult } from '@/ipc/core';
import { isPathInside, isSamePath, resolveFilesystemPath, pathExistsSafely, readPathInfo } from '@/lib/filesystem/path';
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
import { findLinkedInstallFolders } from '@/modules/bsmanager/main/linked-folders';
import type { BSManagerSharedContentConverter } from '@/modules/bsmanager/main/shared-content-converter';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import { customInstallName, stripMechanicalSuffix } from '@/modules/installs/main/naming';
import type { LibrarySettingsPatch } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import {
   configuredSharedFolderDefinitions,
   isCustomSharedFolderId,
   relativeFolderPathSchema,
   sharedFolderDefinitions,
   sharedFolderRelativePath,
   type CustomSharedFolder,
   type SharedFolderDefinition
} from '@/modules/shared-content/contract';
import { customSharedFolderId } from '@/modules/shared-content/main/custom-folder-id';
import { readFolderLink } from '@/modules/shared-content/main/folder-link';
import { defaultSharedContentRootPath, installFolderPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';
import { localTargetId } from '@/modules/targets/contract';

import { readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

type AdoptionServiceOptions = {
   registry: InstallRegistry;
   settingsStore: SettingsStore;
   converter: BSManagerSharedContentConverter;
   locations: BSManagerLocations;
};

type DescribedBSManagerVersion = Omit<BSManagerVersion, 'folders'> & { exists: boolean };

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
      const described = await describeVersions(versionsPath, sharedContentPath, config['custom-versions'], settings.library.customFolders);
      const versions = described.versions;

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
         customFolders: described.customFolders,
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

      const settings = await options.settingsStore.getSnapshot();
      const selectedCustomFolderIds = new Set(
         selected.flatMap((version) =>
            version.folders
               .filter((folder) => isCustomSharedFolderId(folder.id) && folder.state !== 'absent' && folder.state !== 'unlinked')
               .map((folder) => folder.id)
         )
      );
      const customFolders = mergeCustomFolders(
         settings.library.customFolders,
         planned.customFolders.filter((folder) => selectedCustomFolderIds.has(folder.id))
      );
      const libraryPatch: LibrarySettingsPatch = { customFolders };

      if (request.adoptSharedRoot) {
         const knownRoots = settings.library.sharedRoots.filter((root) => !isSamePath(root, planned.sharedContentPath));
         // the previous root stays known when it exists on disk, so links into it stay healthy
         const keepPrevious =
            !planned.sharedRootAdopted &&
            !knownRoots.some((root) => isSamePath(root, planned.currentSharedRootPath)) &&
            (await pathExistsSafely(planned.currentSharedRootPath));
         libraryPatch.sharedRoot = planned.sharedContentPath;
         libraryPatch.sharedRoots = keepPrevious ? [...knownRoots, planned.currentSharedRootPath] : knownRoots;
         libraryPatch.useSymlinks = planned.useSymlinks;
      }

      if (request.adoptSharedRoot || customFolders.length !== settings.library.customFolders.length) {
         const written = await options.settingsStore.updateLibrarySettings(libraryPatch);
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

   async function migrateAdoptedSetup() {
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

      const settings = await options.settingsStore.getSnapshot();
      const described = await describeVersions(
         bsmanagerVersionsPath(resolved.rootPath),
         bsmanagerSharedContentPath(resolved.rootPath),
         config['custom-versions'],
         settings.library.customFolders
      );
      const adoptedCustomFolderIds = new Set(
         described.versions
            .filter((version) => version.status === 'adopted')
            .flatMap((version) =>
               version.folders
                  .filter((folder) => isCustomSharedFolderId(folder.id) && folder.state !== 'absent' && folder.state !== 'unlinked')
                  .map((folder) => folder.id)
            )
      );
      const customFolders = mergeCustomFolders(
         settings.library.customFolders,
         described.customFolders.filter((folder) => adoptedCustomFolderIds.has(folder.id))
      );
      if (customFolders.length !== settings.library.customFolders.length) {
         return options.settingsStore.updateLibrarySettings({ customFolders });
      }
   }

   async function describeVersions(
      versionsPath: string,
      sharedContentPath: string,
      configured: BSManagerConfigVersion[],
      configuredCustomFolders: CustomSharedFolder[]
   ) {
      const entries = await Result.tryPromise({
         try: () => readdir(versionsPath, { withFileTypes: true }),
         catch: (cause) => cause
      });
      const folderNames = Result.isOk(entries)
         ? entries.value.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name)
         : [];
      const names = [...new Set([...folderNames, ...configured.map((version) => bsmanagerVersionFolderName(version))])].sort();
      const registered = await options.registry.list();
      const described: DescribedBSManagerVersion[] = [];

      for (const name of names) {
         const path = resolveFilesystemPath(join(versionsPath, name));
         const match = configured.find((version) => bsmanagerVersionFolderName(version) === name) ?? null;
         const install = registered.installs.find((candidate) => isSamePath(candidate.path, path)) ?? null;
         const exists = await pathExistsSafely(path);
         const store = bsmanagerStoreKind(match, exists ? await readBSManagerVersionStore(path) : null);

         if (install && !install.store) await options.registry.associateStore(install.id, store);

         described.push({
            id: name,
            name: customInstallName(name),
            version: stripMechanicalSuffix(match?.BSVersion ?? name),
            path,
            store,
            color: match?.color ?? null,
            status: install ? 'adopted' : exists ? 'ready' : 'missing',
            installId: install?.id ?? null,
            exists
         });
      }

      const customFolders = await discoverCustomFolders(described, sharedContentPath, configuredCustomFolders);
      const definitions = configuredSharedFolderDefinitions(customFolders);
      const versions: BSManagerVersion[] = [];

      for (const version of described) {
         const { exists, ...summary } = version;
         versions.push({
            ...summary,
            folders: exists ? await describeFolders(version.path, sharedContentPath, definitions) : []
         });
      }

      return { customFolders, versions };
   }

   async function describeFolders(installPath: string, sharedContentPath: string, definitions: SharedFolderDefinition[]) {
      const folders: BSManagerFolderLink[] = [];

      for (const definition of definitions) {
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

   return { detect, plan, adopt, cleanup, migrateAdoptedSetup };
}

async function discoverCustomFolders(versions: DescribedBSManagerVersion[], sharedContentPath: string, configured: CustomSharedFolder[]) {
   const customFolders = [...configured];
   const builtInPaths = new Set(sharedFolderDefinitions.map((definition) => relativePathKey(sharedFolderRelativePath(definition))));

   for (const version of versions) {
      if (!version.exists) continue;

      const links = await findLinkedInstallFolders(version.path);
      for (const link of links) {
         if (builtInPaths.has(relativePathKey(link.installRelativePath))) continue;
         if (customFolders.some((folder) => relativePathKey(folder.installRelativePath) === relativePathKey(link.installRelativePath))) continue;

         const targetRelativePath = isPathInside(sharedContentPath, link.linkTargetPath)
            ? relative(sharedContentPath, link.linkTargetPath).split(sep).join('/')
            : basename(link.installRelativePath);
         const parsedTarget = relativeFolderPathSchema.safeParse(targetRelativePath);
         if (!parsedTarget.success) continue;

         customFolders.push({
            id: customSharedFolderId(link.installRelativePath, parsedTarget.data),
            installRelativePath: link.installRelativePath,
            libraryRelativePath: parsedTarget.data
         });
      }
   }

   return customFolders;
}

function mergeCustomFolders(current: CustomSharedFolder[], incoming: CustomSharedFolder[]) {
   const merged = [...current];

   for (const folder of incoming) {
      if (merged.some((candidate) => relativePathKey(candidate.installRelativePath) === relativePathKey(folder.installRelativePath))) continue;
      merged.push(folder);
   }

   return merged;
}

function relativePathKey(path: string) {
   return path.replaceAll('\\', '/').toLowerCase();
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
