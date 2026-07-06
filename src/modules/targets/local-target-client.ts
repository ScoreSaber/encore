import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { TargetClient } from '@/shared/targets';

export function createLocalTargetClient(): TargetClient {
   const api = getEncoreApi();

   return {
      listTargets: () => api.targets.list(),
      listInstalls: (targetId) => api.targets.listInstalls(targetId),
      getHealth: (targetId) => api.targets.getHealth(targetId),
      getStoreDetection: (targetId) => api.targets.getStoreDetection(targetId),
      rescanStores: (targetId) => api.targets.rescanStores(targetId),
      onEvent: (listener) => api.targets.onEvent(listener)
   };
}
