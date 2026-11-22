import { beatSaberPackageId } from '@/modules/quest/contract';

import { posix } from 'node:path';

export const questModDataDir = `/sdcard/ModData/${beatSaberPackageId}`;
export const questModloaderDir = `${questModDataDir}/Modloader`;
export const questEarlyModsDir = `${questModloaderDir}/early_mods`;
export const questLateModsDir = `${questModloaderDir}/mods`;
export const questLibsDir = `${questModloaderDir}/libs`;
export const questScotland2Path = `${questModloaderDir}/libsl2.so`;
export const questPackagesDir = `${questModDataDir}/Packages`;
export const questDataKeeperPlayerDataPath = `${questModDataDir}/Mods/datakeeper/PlayerData.dat`;

export const questObbDir = `/sdcard/Android/obb/${beatSaberPackageId}`;
export const questPlayerDataPath = `/sdcard/Android/data/${beatSaberPackageId}/files/PlayerData.dat`;

export const questRecordsPath = `${questModDataDir}/encore-mods.json`;
export const questStagingDir = `${questModDataDir}/encore-staging`;
export const questAuxiliaryPlayerDataPath = '/sdcard/Encore/PlayerData.backup.dat';
export const questSavedPlayerDataPath = '/sdcard/Encore/PlayerData.modded.dat';
export const questMergedPlayerDataPath = '/sdcard/Encore/PlayerData.modded.merged.dat';
export const questPlayerDataBeforeMergePath = '/sdcard/Encore/PlayerData.before-merge.dat';
export const questPlayerDataMergingPath = '/sdcard/Encore/PlayerData.merging.dat';
export const questDowngradeAgentDir = '/data/local/tmp/encore-mbf';

const backupDir = '/data/local/tmp/encore-patch';
export const questBackup = {
   dir: backupDir,
   done: `${backupDir}/done`,
   apk: `${backupDir}/original.apk`,
   version: `${backupDir}/version`,
   obbDir: `${backupDir}/obb`,
   playerData: `${backupDir}/PlayerData.dat`,
   downgradedDone: `${backupDir}/downgraded-done`,
   downgradedObbDir: `${backupDir}/downgraded-obb`,
   downgradeVersion: `${backupDir}/downgrade-version`,
   runtime: `${backupDir}/runtime.json`
};

export function questRuntimeModsDir(version: string, archiveId: string) {
   return `${questModDataDir}/Encore/Runtime/${version}/${archiveId}`;
}

export function questMapsDir(gameVersion: string | null) {
   const minor = Number(/^1\.(\d+)/.exec(gameVersion ?? '')?.[1]);
   return `${questModDataDir}/Mods/${minor < 35 ? 'SongLoader' : 'SongCore'}/CustomLevels`;
}

const reservedModFiles = new Set([questDataKeeperPlayerDataPath, questRecordsPath, questScotland2Path]);
const reservedModDirs = [questPackagesDir, questStagingDir, `${questModDataDir}/Encore`];

export function isQuestModFile(path: string) {
   return (
      path.startsWith(`${questModDataDir}/`) &&
      posix.normalize(path) === path &&
      /^[^./][^/]*\.\w+$/.test(posix.basename(path)) &&
      !path.endsWith('/') &&
      !reservedModFiles.has(path) &&
      !reservedModDirs.some((dir) => path.startsWith(`${dir}/`))
   );
}

export function isQuestPackagePath(path: string) {
   return (
      path.startsWith(`${questPackagesDir}/`) &&
      posix.normalize(path) === path &&
      /^(?:[\w.-]+\.qmod|\d[\w.-]*\/[\w.-]+)$/.test(path.slice(questPackagesDir.length + 1))
   );
}

export function questPackagePath(modId: string) {
   return `${questPackagesDir}/${sanitizeQuestFileName(modId)}.qmod`;
}

export function sanitizeQuestFileName(name: string) {
   return name.replaceAll(/[^A-Za-z0-9._-]/g, '_');
}
