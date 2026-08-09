import { broadcastIpcEvent, defineIpcHandlers } from '@/ipc/main';
import { targetsIpc } from '@/modules/targets/ipc';
import type { TargetRegistry } from '@/modules/targets/main/target-registry';

export function createTargetsIpcModule(registry: TargetRegistry) {
   registry.subscribe((event) => broadcastIpcEvent(targetsIpc.onEvent, event));

   return defineIpcHandlers(targetsIpc, {
      list: () => registry.listTargets(),
      getHealth: (_event, request) => registry.getHealth(request.targetId)
   });
}
