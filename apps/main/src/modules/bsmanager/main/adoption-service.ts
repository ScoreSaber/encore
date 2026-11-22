import { Result } from 'better-result';

import { createProblem } from '@/lib/errors';
import { isPathInside, isSamePath, resolveFilesystemPath, pathExistsSafely, readPathInfo } from '@/lib/filesystem/path';
import {
   invalidBSManagerPlan,
   type BSManagerAdoptInput,
   type BSManagerCleanupInput,
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
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import {
   configuredSharedFolderDefinitions,
   isCustomSharedFolderId,
   relativeFolderPathKey,
   relativeFolderPathSchema,
   sharedFolderDefinitions,
   sharedFolderRelativePath,
   type CustomSharedFolder,
   type SharedFolderDefinition
} from '@/modules/shared-content/contract';
import { readFolderLink } from '@/modules/shared-content/main/folder-link';
import { customSharedFolderId } from '@/modules/shared-content/main/shared-library';
import { defaultSharedContentRootPath, installFolderPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';

import { readdir } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';

type AdoptionServiceOptions = {
   registry: InstallRegistry;
   settingsStore: SettingsStore;
   converter: BSManagerSharedContentConverter;
   locations: BSManagerLocations;
};

type DescribedBSManagerVersion = Omit<BSManagerVersion, 'folders'> & { exists: boolean };

export function createBSManagerAdoptionService(options: AdoptionServiceOptions) {
   async function detect(): Promise<BSManagerDetection> {
      const resolved = await resolveRoot();

      if (!resolved.rootPath) {
         return { status: 'missing', rootPath: null, sharedContentPath: null, searchedPaths: resolved.searchedPaths };
      }

      const settings = await options.settingsStore.getSnapshot();
      const detectedSharedPath = bsmanagerSharedContentPath(resolved.rootPath);
      const activeSharedPath = settings.library.sharedRoot ?? defaultSharedContentRootPath(settings.library.installRoot);
      const sharedContentPath =
         [activeSharedPath, ...settings.library.sharedRoots].find((path) => isSamePath(path, detectedSharedPath)) ?? detectedSharedPath;

      return {
         status: 'detected',
         rootPath: resolved.rootPath,
         sharedContentPath,
         searchedPaths: resolved.searchedPaths
      };
   }

   async function plan(): Promise<BSManagerPlan> {
      const resolved = await resolveRoot();
      if (!resolved.rootPath) return invalidBSManagerPlan('', 'not-found', resolved.searchedPaths.join(', '));

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

      if (versions.length === 0) return invalidBSManagerPlan(rootPath, 'nothing-to-adopt');

      return {
         status: 'ok',
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

   async function adopt(request: BSManagerAdoptInput) {
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
      const linksNewFolders =
         withLinkedCustomFolders(settings.library.customFolders, planned.customFolders, selected).length !== settings.library.customFolders.length;
      const previousRootExists = request.adoptSharedRoot && !planned.sharedRootAdopted && (await pathExistsSafely(planned.currentSharedRootPath));

      if (request.adoptSharedRoot || linksNewFolders) {
         const written = await options.settingsStore.updateLibrarySettingsWith((library) => {
            const customFolders = withLinkedCustomFolders(library.customFolders, planned.customFolders, selected);
            if (!request.adoptSharedRoot) return { customFolders };

            const knownRoots = library.sharedRoots.filter((root) => !isSamePath(root, planned.sharedContentPath));
            const keepPrevious = previousRootExists && !knownRoots.some((root) => isSamePath(root, planned.currentSharedRootPath));
            return {
               customFolders,
               sharedRoot: planned.sharedContentPath,
               sharedRoots: keepPrevious ? [...knownRoots, planned.currentSharedRootPath] : knownRoots,
               useSymlinks: planned.useSymlinks
            };
         });
         if (!written.ok) return failure('register-failed', written.error.message);
      }

      return Result.ok({
         rootPath: planned.rootPath,
         sharedRootPath: request.adoptSharedRoot ? planned.sharedContentPath : planned.currentSharedRootPath,
         adopted,
         skipped: planned.versions.length - adopted
      });
   }

   async function cleanup(request: BSManagerCleanupInput) {
      const planned = await plan();
      if (planned.status === 'invalid') return failure(planned.issue, planned.detail);
      if (!isSamePath(request.rootPath, planned.rootPath)) return failure('not-bsmanager');

      const versions = planned.versions.filter((version) => version.status !== 'missing');
      const started = options.converter.start(planned, versions);
      return Result.isError(started) ? failure(started.error) : Result.ok(started.value);
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
      const adopted = described.versions.filter((version) => version.status === 'adopted');
      const linkFolders = (current: CustomSharedFolder[]) => withLinkedCustomFolders(current, described.customFolders, adopted);
      if (linkFolders(settings.library.customFolders).length !== settings.library.customFolders.length) {
         return options.settingsStore.updateLibrarySettingsWith((library) => ({ customFolders: linkFolders(library.customFolders) }));
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
   const builtInPaths = new Set(sharedFolderDefinitions.map((definition) => relativeFolderPathKey(sharedFolderRelativePath(definition))));

   for (const version of versions) {
      if (!version.exists) continue;

      const links = await findLinkedInstallFolders(version.path);
      for (const link of links) {
         if (builtInPaths.has(relativeFolderPathKey(link.installRelativePath))) continue;
         if (customFolders.some((folder) => relativeFolderPathKey(folder.installRelativePath) === relativeFolderPathKey(link.installRelativePath)))
            continue;

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

function withLinkedCustomFolders(current: CustomSharedFolder[], discovered: CustomSharedFolder[], versions: BSManagerVersion[]) {
   const linkedIds = new Set(
      versions.flatMap((version) =>
         version.folders
            .filter((folder) => isCustomSharedFolderId(folder.id) && folder.state !== 'absent' && folder.state !== 'unlinked')
            .map((folder) => folder.id)
      )
   );
   const merged = [...current];

   for (const folder of discovered) {
      if (!linkedIds.has(folder.id)) continue;
      if (merged.some((candidate) => relativeFolderPathKey(candidate.installRelativePath) === relativeFolderPathKey(folder.installRelativePath)))
         continue;
      merged.push(folder);
   }

   return merged;
}

function failure(issue: BSManagerIssue, detail?: string) {
   return Result.err(createProblem(`bsmanager.${issue}`, { detail }));
}
