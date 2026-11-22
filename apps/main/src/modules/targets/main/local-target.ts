import { isSteamFrame } from '@/lib/platform/steam-frame';
import { findOculusInstalls } from '@/modules/stores/main/oculus';
import { findSteamInstalls } from '@/modules/stores/main/steam';
import { localTargetId, type Target, type TargetCapability } from '@/modules/targets/contract';

import { hostname } from 'node:os';

export function getLocalTarget(): Target {
   const capabilities: TargetCapability[] = [
      'browse-files',
      'import-install',
      'list-installs',
      'manage-installs',
      'manage-maps',
      'manage-models',
      'manage-mods',
      'manage-playlists',
      'read-logs',
      'run-operations',
      'share-content',
      'update-app'
   ];

   if (process.platform === 'win32' || process.platform === 'linux')
      capabilities.push('adopt-bsmanager', 'download-install', 'launch-install', 'mirror-install');

   const target: Target = { id: localTargetId, kind: 'local', name: hostname(), status: 'ready', capabilities };
   if (isSteamFrame()) target.hardware = 'steam-frame';
   return target;
}

export async function detectLocalStores() {
   return (await Promise.all([findSteamInstalls(), findOculusInstalls()])).flat();
}
