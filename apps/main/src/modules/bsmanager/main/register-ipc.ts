import { defineIpcHandlers } from '@/ipc/main';
import { invalidBSManagerPlan, type BSManagerDetection } from '@/modules/bsmanager/contract';
import { bsmanagerIpc } from '@/modules/bsmanager/ipc';
import type { BSManagerAdoptionService } from '@/modules/bsmanager/main/adoption-service';
import { localTargetId, type TargetId } from '@/modules/targets/contract';
import { unsupportedTarget } from '@/modules/targets/main/target-errors';

export function createBSManagerIpcModule(service: BSManagerAdoptionService) {
   return defineIpcHandlers(bsmanagerIpc, {
      detectBSManager: (_event, request) => (request.targetId === localTargetId ? service.detect() : unsupportedDetection(request.targetId)),
      planBSManagerAdoption: (_event, request) =>
         request.targetId === localTargetId ? service.plan() : invalidBSManagerPlan(request.targetId, '', 'unsupported-target'),
      adoptBSManager: (_event, request) =>
         request.targetId === localTargetId
            ? service.adopt({ rootPath: request.rootPath, versionIds: request.versionIds, adoptSharedRoot: request.adoptSharedRoot })
            : unsupportedTarget('bsmanager', 'adopt a BSManager setup', request),
      cleanupBSManagerSharedContent: (_event, request) =>
         request.targetId === localTargetId
            ? service.cleanup({ rootPath: request.rootPath })
            : unsupportedTarget('bsmanager', 'adopt a BSManager setup', request)
   });
}

function unsupportedDetection(targetId: TargetId): BSManagerDetection {
   return { targetId, status: 'unsupported', rootPath: null, sharedContentPath: null, searchedPaths: [] };
}
