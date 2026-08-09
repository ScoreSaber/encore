import { join } from 'node:path';

export const beatSaberDataFolderName = 'Beat Saber_Data';
export const customLevelsFolderName = 'CustomLevels';
export const infoFileNamePattern = /^info\.dat$/i;

export function customLevelsPath(installPath: string) {
   return join(installPath, beatSaberDataFolderName, customLevelsFolderName);
}
