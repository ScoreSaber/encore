import { join } from 'node:path';

const beatSaberDataFolderName = 'Beat Saber_Data';
const customLevelsFolderName = 'CustomLevels';
export const infoFileNamePattern = /^info\.dat$/i;

export function customLevelsPath(installPath: string) {
   return join(installPath, beatSaberDataFolderName, customLevelsFolderName);
}
