import { BrowserWindow } from 'electron';

import { defineIpcMainCommand, defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import {
   getLocalStoreDetection,
   getLocalTarget,
   getLocalTargetHealth,
   listLocalInstalls,
   rescanLocalStoreDetection
} from '@/main/targets/local-target';
import {
   targetChangedEvent,
   targetHealthQuery,
   targetInstallsQuery,
   targetListQuery,
   targetStoreDetectionQuery,
   targetStoreRescanCommand,
   targetsIpcModule
} from '@/shared/ipc/modules/targets';
import { localTargetId, type TargetEvent } from '@/shared/targets';

export function createTargetsIpcModule() {
   return defineIpcMainModule(targetsIpcModule, [
      defineIpcMainQuery(targetListQuery, () => [getLocalTarget()]),
      defineIpcMainQuery(targetInstallsQuery, (_event, request) => (request.targetId === localTargetId ? listLocalInstalls() : [])),
      defineIpcMainQuery(targetHealthQuery, (_event, request) => (request.targetId === localTargetId ? getLocalTargetHealth() : null)),
      defineIpcMainQuery(targetStoreDetectionQuery, (_event, request) => (request.targetId === localTargetId ? getLocalStoreDetection() : null)),
      defineIpcMainCommand(targetStoreRescanCommand, async (_event, request) => {
         if (request.targetId !== localTargetId) return null;

         const snapshot = await rescanLocalStoreDetection();
         const installs = await listLocalInstalls();

         broadcastTargetEvent({
            type: 'store-detection-updated',
            targetId: localTargetId,
            snapshot
         });
         broadcastTargetEvent({
            type: 'installs-updated',
            targetId: localTargetId,
            installs
         });

         return snapshot;
      })
   ]);
}

function broadcastTargetEvent(event: TargetEvent) {
   for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;

      window.webContents.send(targetChangedEvent.channel, event);
   }
}
