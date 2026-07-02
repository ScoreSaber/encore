import { defineIpcMainModule, defineIpcMainQuery } from '@/main/ipc/register-ipc-modules';
import { getLocalTarget, getLocalTargetHealth, listLocalInstalls, localTargetId } from '@/main/targets/local-target';
import { targetHealthQuery, targetInstallsQuery, targetListQuery, targetsIpcModule } from '@/shared/ipc/modules/targets';

export function createTargetsIpcModule() {
   return defineIpcMainModule(targetsIpcModule, [
      defineIpcMainQuery(targetListQuery, () => [getLocalTarget()]),
      defineIpcMainQuery(targetInstallsQuery, (_event, request) => (request.targetId === localTargetId ? listLocalInstalls() : [])),
      defineIpcMainQuery(targetHealthQuery, (_event, request) => (request.targetId === localTargetId ? getLocalTargetHealth() : null))
   ]);
}
