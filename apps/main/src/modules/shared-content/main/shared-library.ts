import { Result } from 'better-result';

import { causeMessage } from '@/lib/errors';
import {
   isPathInside,
   isSamePath,
   readPathInfo,
   resolveFilesystemPath,
   pathExistsSafely,
   resolveManagedPath,
   type PathInfo
} from '@/lib/filesystem/path';
import type { InstallId } from '@/modules/installs/contract';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import type { LibrarySettings, LibrarySettingsPatch } from '@/modules/settings/contract';
import type { SettingsStore } from '@/modules/settings/main/settings-store';
import {
   configuredSharedFolderDefinitions,
   createCustomSharedFolderDefinition,
   isCustomSharedFolderId,
   relativeFolderPathKey,
   relativeFolderPathSchema,
   relativeFolderPathsOverlap,
   sharedFolderLibraryRelativePath,
   sharedFolderRelativePath,
   type AddCustomSharedFolderRequest,
   type CustomSharedFolder,
   type CustomSharedFolderActionResult,
   type CustomSharedFolderChoice,
   type ForgetCustomSharedFolderRequest,
   type SharedFolderDefinition,
   type SharedRootActionResult,
   type SharedRootCandidate,
   type SharedRootRequest
} from '@/modules/shared-content/contract';
import { readFolderStatus } from '@/modules/shared-content/main/shared-folder-status';
import { defaultSharedContentRootPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';

import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

type Library = {
   installRoot: string;
   sharedRootPath: string;
   rootPaths: string[];
   customFolders: CustomSharedFolder[];
   definitions: SharedFolderDefinition[];
   useSymlinks: boolean;
};

type InspectedCustomFolder = Extract<CustomSharedFolderChoice, { status: 'invalid' }> | { status: 'ok'; relativePath: string; info: PathInfo };

const unsafeCustomFolderPaths = ['Beat Saber_Data', 'IPA', 'Libs', 'Plugins', 'MonoBleedingEdge'];

export function customSharedFolderId(installRelativePath: string, libraryRelativePath: string) {
   const hash = createHash('sha256')
      .update(installRelativePath)
      .update(String.fromCodePoint(0))
      .update(libraryRelativePath)
      .digest('hex')
      .slice(0, 24);

   return `custom-${hash}`;
}

export function findKnownRoot(library: Library, path: string) {
   return library.rootPaths.find((root) => isSamePath(root, path)) ?? null;
}

export async function isRootInsideInstall(rootPath: string, installPath: string) {
   const [root, install] = await Promise.all([physicalPath(rootPath), physicalPath(installPath)]);

   return isSamePath(root, install) || isPathInside(install, root);
}

export function sharedRootPaths(settings: LibrarySettings) {
   return toLibrary(settings).rootPaths;
}

async function physicalPath(path: string): Promise<string> {
   const resolved = resolveFilesystemPath(path);
   const real = await Result.tryPromise(() => realpath(resolved));
   if (Result.isOk(real)) return real.value;

   const parent = dirname(resolved);
   return parent === resolved ? resolved : join(await physicalPath(parent), basename(resolved));
}

export function createSharedLibrary(options: { registry: InstallRegistry; settingsStore: SettingsStore; onChange: () => void }) {
   async function read() {
      return toLibrary((await options.settingsStore.getSnapshot()).library);
   }

   async function chooseCustomFolder({ installId, path }: { installId: InstallId; path: string }): Promise<CustomSharedFolderChoice> {
      const inspected = await inspectCustomFolder(installId, path);
      if (inspected.status === 'invalid') return inspected;

      return { status: 'selected', relativePath: inspected.relativePath };
   }

   async function addCustomFolder(request: AddCustomSharedFolderRequest): Promise<CustomSharedFolderActionResult> {
      const inspected = await inspectCustomFolder(request.installId, request.relativePath);
      if (inspected.status === 'invalid') return inspected;

      const library = await read();
      const installRelativePath = inspected.relativePath;
      const existingDefinition = library.definitions.find(
         (definition) => relativeFolderPathKey(sharedFolderRelativePath(definition)) === relativeFolderPathKey(installRelativePath)
      );
      if (existingDefinition) return { status: 'invalid', issue: 'already-added' };

      const insideGameFolder = unsafeCustomFolderPaths.some((unsafe) => relativeFolderPathsOverlap(unsafe, installRelativePath));
      if (insideGameFolder) return { status: 'invalid', issue: 'unsafe-folder' };

      const overlappingCustom = library.customFolders.find((folder) => relativeFolderPathsOverlap(folder.installRelativePath, installRelativePath));
      if (overlappingCustom) return { status: 'invalid', issue: 'overlapping-folder', detail: overlappingCustom.installRelativePath };

      const libraryRelativePath = inferredLibraryRelativePath(inspected.info.targetPath, library) ?? installRelativePath;
      const folder: CustomSharedFolder = {
         id: customSharedFolderId(installRelativePath, libraryRelativePath),
         installRelativePath,
         libraryRelativePath
      };
      const definitions = configuredSharedFolderDefinitions([...library.customFolders, folder]);

      const sourceOverlap = definitions.find(
         (definition) => definition.id !== folder.id && relativeFolderPathsOverlap(sharedFolderRelativePath(definition), installRelativePath)
      );
      if (sourceOverlap) {
         return {
            status: 'invalid',
            issue: isCustomSharedFolderId(sourceOverlap.id) ? 'overlapping-folder' : 'unsafe-folder',
            detail: sharedFolderRelativePath(sourceOverlap)
         };
      }

      const destinationOverlap = definitions.find(
         (definition) => definition.id !== folder.id && relativeFolderPathsOverlap(sharedFolderLibraryRelativePath(definition), libraryRelativePath)
      );
      if (destinationOverlap) {
         return { status: 'invalid', issue: 'destination-conflict', detail: sharedFolderLibraryRelativePath(destinationOverlap) };
      }

      const written = await options.settingsStore.updateLibrarySettingsWith((current) => ({
         customFolders: [...current.customFolders.filter((candidate) => candidate.id !== folder.id), folder]
      }));
      if (!written.ok) return { status: 'invalid', issue: 'write-failed', detail: written.error.message };

      options.onChange();
      return { status: 'ok', folder };
   }

   async function forgetCustomFolder(request: ForgetCustomSharedFolderRequest): Promise<CustomSharedFolderActionResult> {
      const library = await read();
      const folder = library.customFolders.find((candidate) => candidate.id === request.folderId);
      if (!folder) return { status: 'invalid', issue: 'unknown-folder' };

      const definition = createCustomSharedFolderDefinition(folder);

      const registrySnapshot = await options.registry.list();
      for (const install of registrySnapshot.installs) {
         const status = await readFolderStatus(install.path, library.sharedRootPath, definition, library.rootPaths);
         if (status.state === 'broken' || status.state === 'foreign' || status.state === 'linked') {
            return { status: 'invalid', issue: 'folder-linked', detail: install.name };
         }
      }

      const written = await options.settingsStore.updateLibrarySettingsWith((current) => ({
         customFolders: current.customFolders.filter((candidate) => candidate.id !== folder.id)
      }));
      if (!written.ok) return { status: 'invalid', issue: 'write-failed', detail: written.error.message };

      options.onChange();
      return { status: 'ok', folder };
   }

   async function inspectCustomFolder(installId: InstallId, path: string): Promise<InspectedCustomFolder> {
      const install = await options.registry.get(installId);
      if (!install) return { status: 'invalid', issue: 'install-not-found' };

      const managed = await resolveManagedPath({ root: install.path, path });
      if (Result.isError(managed)) {
         return { status: 'invalid', issue: 'outside-install', detail: managed.error.message };
      }

      const info = await readPathInfo(managed.value.path);
      if (Result.isError(info)) return { status: 'invalid', issue: 'unsafe-folder', detail: info.error.message };
      if (info.value.kind !== 'directory' && (info.value.kind !== 'link' || info.value.targetKind !== 'directory')) {
         return { status: 'invalid', issue: 'unsafe-folder' };
      }

      const relativePath = managed.value.relativePath.split(sep).join('/');
      return { status: 'ok', relativePath, info: info.value };
   }

   async function chooseRootCandidate(input: SharedRootRequest) {
      const resolvedPath = resolveFilesystemPath(input.path);
      const library = await read();
      const exists = await pathExistsSafely(resolvedPath);
      const foldersFound: SharedRootCandidate['foldersFound'] = [];

      for (const definition of library.definitions) {
         if (await pathExistsSafely(sharedFolderPath(resolvedPath, definition))) {
            foldersFound.push({
               id: definition.id,
               relativePath: sharedFolderRelativePath(definition)
            });
         }
      }

      return {
         path: resolvedPath,
         exists,
         alreadyKnown: findKnownRoot(library, resolvedPath) !== null,
         foldersFound
      };
   }

   async function addRoot({ path, activate = false }: { path: string; activate?: boolean }): Promise<SharedRootActionResult> {
      const resolvedPath = resolveFilesystemPath(path);

      const registrySnapshot = await options.registry.list();
      const insideInstall = await Promise.all(registrySnapshot.installs.map((install) => isRootInsideInstall(resolvedPath, install.path)));
      if (insideInstall.includes(true)) return { status: 'invalid', issue: 'root-inside-install' };

      const created = await Result.tryPromise({
         try: () => mkdir(resolvedPath, { recursive: true }),
         catch: causeMessage
      });
      if (Result.isError(created)) return { status: 'invalid', issue: 'create-failed', detail: created.error };

      return updateRoots((library) => {
         if (activate) return activationPatch(library, resolvedPath);
         if (findKnownRoot(library, resolvedPath)) return {};

         return { sharedRoots: [...otherRoots(library, resolvedPath), resolvedPath] };
      });
   }

   async function activateRoot(input: SharedRootRequest): Promise<SharedRootActionResult> {
      const resolvedPath = resolveFilesystemPath(input.path);
      const library = await read();
      if (!findKnownRoot(library, resolvedPath)) return { status: 'invalid', issue: 'root-unknown' };

      return updateRoots((current) => activationPatch(current, resolvedPath));
   }

   async function forgetRoot(input: SharedRootRequest): Promise<SharedRootActionResult> {
      const resolvedPath = resolveFilesystemPath(input.path);
      const library = await read();
      if (isSamePath(resolvedPath, library.sharedRootPath)) return { status: 'invalid', issue: 'root-active' };
      if (!findKnownRoot(library, resolvedPath)) return { status: 'invalid', issue: 'root-unknown' };

      return updateRoots((current) => ({ sharedRoots: otherRoots(current, resolvedPath) }));
   }

   async function updateRoots(patch: (library: Library) => LibrarySettingsPatch): Promise<SharedRootActionResult> {
      const written = await options.settingsStore.updateLibrarySettingsWith((current) => patch(toLibrary(current)));
      if (!written.ok) return { status: 'invalid', issue: 'create-failed', detail: written.error.message };

      options.onChange();
      return { status: 'ok' };
   }

   async function isKnownRoot(path: string) {
      return findKnownRoot(await read(), path) !== null;
   }

   return { read, chooseCustomFolder, addCustomFolder, forgetCustomFolder, chooseRootCandidate, addRoot, activateRoot, forgetRoot, isKnownRoot };
}

function toLibrary(settings: LibrarySettings): Library {
   const sharedRootPath = settings.sharedRoot ?? defaultSharedContentRootPath(settings.installRoot);
   const rootPaths = [sharedRootPath];

   for (const root of settings.sharedRoots) {
      if (!rootPaths.some((known) => isSamePath(known, root))) rootPaths.push(root);
   }

   return {
      installRoot: settings.installRoot,
      sharedRootPath,
      rootPaths,
      customFolders: settings.customFolders,
      definitions: configuredSharedFolderDefinitions(settings.customFolders),
      useSymlinks: settings.useSymlinks
   };
}

function activationPatch(library: Library, rootPath: string): LibrarySettingsPatch {
   return {
      sharedRoot: rootPath,
      sharedRoots: [...otherRoots(library, rootPath), library.sharedRootPath].filter((root) => !isSamePath(root, rootPath))
   };
}

function otherRoots(library: Library, rootPath: string) {
   return library.rootPaths.filter((root) => !isSamePath(root, rootPath) && !isSamePath(root, library.sharedRootPath));
}

function inferredLibraryRelativePath(targetPath: string | undefined, library: Library) {
   if (!targetPath) return null;

   const rootPath = library.rootPaths.find((root) => isPathInside(root, targetPath));
   if (!rootPath) return null;

   const parsed = relativeFolderPathSchema.safeParse(relative(rootPath, targetPath).split(sep).join('/'));
   return parsed.success ? parsed.data : null;
}
