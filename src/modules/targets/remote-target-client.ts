import { getEncoreApi } from '@/renderer/electron/encore-api';
import type { TargetClient } from '@/shared/targets';

export function createRemoteReceiverTargetClient(): TargetClient {
   const api = getEncoreApi();

   return {
      listTargets: () => api.receiver.listRemoteTargets(),
      listInstalls: (targetId) => api.receiver.listRemoteInstalls(targetId),
      getHealth: (targetId) => api.receiver.getRemoteHealth(targetId),
      onEvent: (listener) => api.receiver.onRemoteTargetEvent(listener)
   };
}
