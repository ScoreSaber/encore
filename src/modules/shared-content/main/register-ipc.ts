import { shell, type IpcMainInvokeEvent } from 'electron';

import { showOpenDialog } from '@/app/ipc/dialogs';
import { defineIpcHandlers } from '@/app/ipc/main';
import type { TargetSharedContentRequest } from '@/modules/shared-content/api';
import type { SharedContentOpenFolderResult, SharedFolderRequest, SharedRootChoice, SharedRootRequest } from '@/modules/shared-content/contract';
import { sharedContentIpc } from '@/modules/shared-content/ipc';
import type { SharedContentService } from '@/modules/shared-content/main/shared-content-service';
import { localTargetId, type TargetId, type TargetRequest } from '@/modules/targets/contract';

export function createSharedContentIpcModule(service: SharedContentService) {
   return defineIpcHandlers(sharedContentIpc, {
      openSharedFolder: (_event, request) => openSharedFolder(service, request),
      chooseSharedRoot: (event, request) => chooseSharedRoot(event, service, request),
      openSharedRoot: (_event, request) => openSharedRoot(service, request)
   });
}

async function openSharedFolder(
   service: SharedContentService,
   request: TargetSharedContentRequest & SharedFolderRequest
): Promise<SharedContentOpenFolderResult> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const path = await service.getFolderPath({ installId: request.installId, folderId: request.folderId });
   if (!path) return { status: 'failed', message: 'that folder cannot be shared' };

   const failed = await shell.openPath(path);
   return failed ? { status: 'failed', message: failed } : { status: 'opened' };
}

async function chooseSharedRoot(
   event: IpcMainInvokeEvent,
   service: SharedContentService,
   request: { targetId: TargetId }
): Promise<SharedRootChoice> {
   if (request.targetId !== localTargetId) return { status: 'cancelled' };

   const picked = await showOpenDialog(event, { properties: ['openDirectory', 'createDirectory'] });
   const path = picked.filePaths[0];
   if (picked.canceled || !path) return { status: 'cancelled' };

   const candidate = await service.chooseRootCandidate({ path });

   return { status: 'selected', ...candidate };
}

async function openSharedRoot(service: SharedContentService, request: TargetRequest<SharedRootRequest>): Promise<SharedContentOpenFolderResult> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };
   if (!(await service.isKnownRoot(request.path))) return { status: 'failed', message: 'that folder is not a known shared content root' };

   const failed = await shell.openPath(request.path);
   return failed ? { status: 'failed', message: failed } : { status: 'opened' };
}
