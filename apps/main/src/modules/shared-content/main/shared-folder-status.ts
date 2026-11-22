import { Result } from 'better-result';

import { isSamePath, resolveFilesystemPath, resolveManagedPath } from '@/lib/filesystem/path';
import { getDirectorySize } from '@/lib/filesystem/scan';
import type { InstallSummary } from '@/modules/installs/contract';
import {
   sharedFolderRelativePath,
   type SharedFolderDefinition,
   type SharedFolderStatus,
   type SharedLinkSupport
} from '@/modules/shared-content/contract';
import { preferredLinkMode, probeLinkSupport, readFolderLink } from '@/modules/shared-content/main/folder-link';
import type { FolderContext } from '@/modules/shared-content/main/shared-content-transfer';
import { installFolderPath, sharedFolderPath } from '@/modules/shared-content/main/shared-paths';

import { readdir } from 'node:fs/promises';

export async function readFolderStatus(
   installPath: string,
   rootPath: string,
   definition: SharedFolderDefinition,
   knownRoots: string[]
): Promise<SharedFolderStatus> {
   const expectedFolderPath = installFolderPath(installPath, definition);
   const expectedSharedPath = sharedFolderPath(rootPath, definition);
   const [managedFolder, managedShared] = await Promise.all([
      resolveManagedPath({ root: installPath, path: expectedFolderPath }),
      resolveManagedPath({ root: rootPath, path: expectedSharedPath })
   ]);

   if (Result.isError(managedFolder) || Result.isError(managedShared)) {
      return {
         id: definition.id,
         kind: definition.kind,
         relativePath: sharedFolderRelativePath(definition),
         installFolderPath: expectedFolderPath,
         sharedFolderPath: expectedSharedPath,
         state: 'blocked',
         linkTargetPath: null,
         rootPath: null,
         risky: definition.risky
      };
   }

   const folderPath = managedFolder.value.path;
   const sharedPath = managedShared.value.path;
   const link = await readFolderLink(folderPath, sharedPath);
   let state = link.state;
   let linkedRoot = state === 'linked' ? rootPath : null;

   if (state === 'foreign' && link.linkTargetPath) {
      const target = link.linkTargetPath;
      const matched = knownRoots.find((root) => isSamePath(target, sharedFolderPath(root, definition)));
      if (matched) {
         state = 'linked';
         linkedRoot = matched;
      }
   }

   return {
      id: definition.id,
      kind: definition.kind,
      relativePath: sharedFolderRelativePath(definition),
      installFolderPath: folderPath,
      sharedFolderPath: sharedPath,
      state,
      linkTargetPath: link.linkTargetPath,
      rootPath: linkedRoot,
      risky: definition.risky
   };
}

export async function findLinkedInstalls(installs: readonly InstallSummary[], context: FolderContext) {
   const linked: InstallSummary[] = [];

   for (const install of installs) {
      if (install.id === context.install.id) continue;

      const link = await readFolderLink(installFolderPath(install.path, context.definition), context.sharedFolderPath);
      if (link.state === 'linked') linked.push(install);
   }

   return linked;
}

export async function countConflicts(state: SharedFolderStatus['state'], folderPath: string, sharedPath: string) {
   if (state !== 'unlinked') return 0;

   const source = await readEntries(folderPath);
   const destination = await readEntries(sharedPath);
   if (destination.size === 0) return 0;

   return [...source].filter((name) => destination.has(name)).length;
}

export async function readSize(targetPath: string) {
   const size = await getDirectorySize(targetPath);

   return Result.isOk(size) ? size.value : null;
}

export function createLinkSupportCache(platform: NodeJS.Platform) {
   const cached = new Map<string, SharedLinkSupport>();
   const inFlight = new Map<string, Promise<SharedLinkSupport>>();

   return async (rootPath: string, useSymlinks: boolean, force = false) => {
      const requestedMode = preferredLinkMode(platform, useSymlinks);
      const normalized = resolveFilesystemPath(rootPath);
      const key = `${platform === 'win32' ? normalized.toLowerCase() : normalized}\0${requestedMode}`;

      if (!force) {
         const existing = cached.get(key);
         if (existing) return existing;

         const pending = inFlight.get(key);
         if (pending) return pending;
      }

      const probe = probeLinkSupport(rootPath, requestedMode).then((support) => {
         cached.set(key, support);
         return support;
      });
      inFlight.set(key, probe);

      try {
         return await probe;
      } finally {
         if (inFlight.get(key) === probe) inFlight.delete(key);
      }
   };
}

async function readEntries(targetPath: string) {
   const entries = await Result.tryPromise({
      try: () => readdir(targetPath),
      catch: (cause) => cause
   });

   return new Set(Result.isOk(entries) ? entries.value : []);
}
