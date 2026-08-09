import { join } from 'node:path';

const bsmanagerFolderName = 'BSManager';
const bsmanagerVersionsFolderName = 'BSInstances';
const bsmanagerSharedFolderName = 'SharedContent';
const bsmanagerConfigFileName = 'config.cfg';
const bsmanagerAppConfigFolderName = 'bs-manager';
const bsmanagerAppConfigFileName = 'config.json';

export type BSManagerLocations = {
   platform: NodeJS.Platform;
   homePath: string;
   documentsPath: string;
   appDataPath: string;
   dataHomePath?: string;
};

export function bsmanagerAppConfigPath(locations: BSManagerLocations) {
   return join(locations.appDataPath, bsmanagerAppConfigFolderName, bsmanagerAppConfigFileName);
}

export function bsmanagerRootPath(parentPath: string) {
   return join(parentPath, bsmanagerFolderName);
}

export function bsmanagerRootCandidates(locations: BSManagerLocations, configuredParentPath?: string) {
   const parents = [
      ...(configuredParentPath ? [configuredParentPath] : []),
      locations.documentsPath,
      ...(locations.platform === 'linux' ? [locations.dataHomePath ?? join(locations.homePath, '.local', 'share')] : [locations.homePath])
   ];

   return [...new Set(parents.filter(Boolean).map((parent) => bsmanagerRootPath(parent)))];
}

export function bsmanagerVersionsPath(rootPath: string) {
   return join(rootPath, bsmanagerVersionsFolderName);
}

export function bsmanagerSharedContentPath(rootPath: string) {
   return join(rootPath, bsmanagerSharedFolderName);
}

export function bsmanagerConfigPath(rootPath: string) {
   return join(rootPath, bsmanagerConfigFileName);
}
