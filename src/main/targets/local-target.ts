import { detectOfficialStores, storeCandidateToInstallSummary } from '@/main/stores';
import { localTargetId, type InstallSummary, type StoreDetectionSnapshot, type Target, type TargetHealth } from '@/shared/targets';

import { hostname } from 'node:os';

let storeDetectionSnapshot: StoreDetectionSnapshot | null = null;

export function getLocalTarget(): Target {
   return {
      id: localTargetId,
      kind: 'local',
      name: hostname(),
      status: 'ready',
      capabilities: ['detect-stores', 'list-installs']
   };
}

export function getLocalTargetHealth(): TargetHealth {
   const target = getLocalTarget();

   return {
      status: target.status,
      capabilities: target.capabilities
   };
}

export async function listLocalInstalls(): Promise<InstallSummary[]> {
   const snapshot = await getLocalStoreDetection();

   return snapshot.candidates.map(storeCandidateToInstallSummary);
}

export async function getLocalStoreDetection() {
   storeDetectionSnapshot ??= await detectOfficialStores(localTargetId);

   return storeDetectionSnapshot;
}

export async function rescanLocalStoreDetection() {
   storeDetectionSnapshot = await detectOfficialStores(localTargetId);

   return storeDetectionSnapshot;
}
