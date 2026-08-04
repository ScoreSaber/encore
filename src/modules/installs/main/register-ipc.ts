import { shell, type IpcMainInvokeEvent } from 'electron';

import { showOpenDialog } from '@/app/ipc/dialogs';
import { defineIpcHandlers } from '@/app/ipc/main';
import type { InstallActionRequest, InstallImportChoice, InstallOpenFolderResult } from '@/modules/installs/contract';
import { installsIpc } from '@/modules/installs/ipc';
import type { InstallImportService } from '@/modules/installs/main/install-import';
import type { InstallRegistry } from '@/modules/installs/main/install-registry';
import { localTargetId, type TargetId } from '@/modules/targets/contract';

export function createInstallsIpcModule(installs: InstallRegistry, imports: InstallImportService) {
   return defineIpcHandlers(installsIpc, {
      chooseImportSource: (event, request) => chooseImportSource(event, imports, request.targetId),
      import: (_event, request) =>
         request.targetId === localTargetId
            ? imports.start(request.sourcePath)
            : {
                 ok: false,
                 error: {
                    code: 'installs.import.unsupported-target',
                    message: 'this target cannot import an existing folder',
                    details: { targetId: request.targetId }
                 }
              },
      openFolder: (_event, request) => openInstallFolder(installs, request)
   });
}

async function chooseImportSource(event: IpcMainInvokeEvent, imports: InstallImportService, targetId: TargetId): Promise<InstallImportChoice> {
   if (targetId !== localTargetId) return { status: 'unsupported' };

   const picked = await showOpenDialog(event, { properties: ['openDirectory'] });
   const selectedPath = picked.filePaths[0];

   if (picked.canceled || !selectedPath) return { status: 'cancelled' };

   const preview = await imports.preview(selectedPath);

   return { status: 'selected', preview };
}

async function openInstallFolder(registry: InstallRegistry, request: InstallActionRequest): Promise<InstallOpenFolderResult> {
   if (request.targetId !== localTargetId) return { status: 'unsupported' };

   const install = await registry.get(request.installId);
   if (!install) return { status: 'failed', message: 'the install is not in the registry anymore' };

   const failed = await shell.openPath(install.path);
   return failed ? { status: 'failed', message: failed } : { status: 'opened' };
}
