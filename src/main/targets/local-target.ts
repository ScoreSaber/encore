import type { InstallSummary, Target, TargetHealth } from '@/shared/targets';

import { hostname } from 'node:os';

export const localTargetId = 'local';

// stub until the install registry lands
const stubInstalls: InstallSummary[] = [
   {
      id: 'local-1.40.8',
      targetId: localTargetId,
      version: '1.40.8',
      store: null
   }
];

export function getLocalTarget(): Target {
   return {
      id: localTargetId,
      kind: 'local',
      name: hostname(),
      status: 'ready',
      capabilities: ['list-installs']
   };
}

export function getLocalTargetHealth(): TargetHealth {
   const target = getLocalTarget();

   return {
      status: target.status,
      capabilities: target.capabilities
   };
}

export function listLocalInstalls(): InstallSummary[] {
   return stubInstalls;
}
