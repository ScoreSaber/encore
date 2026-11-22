import type { IpcMainInvokeEvent } from 'electron';

import { openLocalPath } from '@/ipc/dialogs';
import { defineIpcHandlers } from '@/ipc/host';
import { sharedContentIpc } from '@/modules/shared-content/ipc';
import type { SharedContentService } from '@/modules/shared-content/main/shared-content-service';

export function createSharedContentIpcModule(service: SharedContentService) {
   return defineIpcHandlers<typeof sharedContentIpc, IpcMainInvokeEvent>(sharedContentIpc, {
      openSharedFolder: (request) => openLocalPath(request.targetId, () => service.getFolderPath(request)),
      openSharedRoot: (request) => openLocalPath(request.targetId, async () => ((await service.isKnownRoot(request.path)) ? request.path : null))
   });
}
