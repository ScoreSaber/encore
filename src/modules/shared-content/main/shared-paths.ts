import type { SharedFolderDefinition } from '@/modules/shared-content/contract';

import { join } from 'node:path';

export const sharedContentDirectoryName = 'shared';

export function defaultSharedContentRootPath(installRoot: string) {
   return join(installRoot, sharedContentDirectoryName);
}

export function sharedFolderPath(sharedRootPath: string, definition: SharedFolderDefinition) {
   return join(sharedRootPath, ...definition.sharedSegments);
}

export function installFolderPath(installPath: string, definition: SharedFolderDefinition) {
   return join(installPath, ...definition.segments);
}

export function backupFolderPath(folderPath: string) {
   return `${folderPath}.encore-backup`;
}

export function conflictFolderPath(folderPath: string) {
   return `${folderPath}.encore-conflicts`;
}
