import { detectOfficialStores } from '@/modules/stores/main/detect-stores';
import { localTargetId, type Target, type TargetCapability, type TargetHealth } from '@/modules/targets/contract';

import { hostname } from 'node:os';

export function getLocalTarget(platform: NodeJS.Platform = process.platform): Target {
   const capabilities: TargetCapability[] = ['read-logs', 'run-operations'];

   if (platform === 'win32' || platform === 'linux') {
      capabilities.push(
         'adopt-bsmanager',
         'import-install',
         'launch-install',
         'list-installs',
         'manage-installs',
         'manage-maps',
         'manage-models',
         'manage-mods',
         'manage-playlists',
         'share-content'
      );
   }

   if (platform === 'win32') capabilities.push('download-install');

   return {
      id: localTargetId,
      kind: 'local',
      name: hostname(),
      status: 'ready',
      capabilities
   };
}

export function getLocalTargetHealth(): TargetHealth {
   const target = getLocalTarget();

   return {
      status: target.status,
      capabilities: target.capabilities
   };
}

export function detectLocalStores() {
   return detectOfficialStores(localTargetId);
}
